// 添加全局状态管理
let classificationState = {
  isRunning: false,
  progress: 0,
  processed: 0,
  total: 0,
  status: ''
};

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'classifyBookmarks') {
    // 如果已经在运行，返回当前状态
    if (classificationState.isRunning) {
      sendResponse({
        isRunning: true,
        progress: classificationState.progress,
        status: classificationState.status,
        processed: classificationState.processed,
        total: classificationState.total
      });
      return true;
    }

    // 开始新的分类任务
    classificationState.isRunning = true;
    classifyBookmarks(request.bookmarks)
      .then(result => {
        classificationState.isRunning = false;
        sendResponse(result);
      })
      .catch(error => {
        classificationState.isRunning = false;
        sendResponse({error: error.message});
      });
    return true;
  } else if (request.action === 'flattenFolders') {
    flattenAllFolders()
      .then(sendResponse)
      .catch(error => sendResponse({error: error.message}));
    return true;
  } else if (request.action === 'cleanDuplicates') {
    cleanDuplicateBookmarks()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({
        success: false,
        error: error.message
      }));
    return true;
  } else if (request.action === 'setApiKey') {
    chrome.storage.sync.set({ apiKey: request.apiKey })
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ 
        success: false, 
        error: error.message 
      }));
    return true;
  } else if (request.action === 'getClassificationState') {
    // 返回当前状态
    sendResponse(classificationState);
    return true;
  }
});

// 打散文件夹的功能
async function flattenAllFolders() {
  try {
    const bookmarks = await chrome.bookmarks.getTree();
    await flattenFolderRecursive(bookmarks[0]);
    return { success: true, message: '文件夹打散完成' };
  } catch (error) {
    throw new Error('打散文件夹失败: ' + error.message);
  }
}

async function flattenFolderRecursive(node) {
  if (node.children) {
    // 复制一份子节点数组，因为我们会修改原数组
    const children = [...node.children];
    for (const child of children) {
      if (child.children) {
        // 是文件夹
        await flattenFolderRecursive(child);
        // 将书签移动到根目录
        for (const bookmark of child.children || []) {
          if (bookmark.url) {
            await chrome.bookmarks.move(bookmark.id, {
              parentId: '1' // '1' 是书签栏的ID
            });
          }
        }
        // 删除空文件夹
        if (child.id !== '1' && child.id !== '2') { // 不删除书签栏和其他书签
          await chrome.bookmarks.remove(child.id);
        }
      }
    }
  }
}

async function classifyBookmarks(bookmarks) {
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  if (!apiKey) {
    throw new Error('请先设置 Google Gemini API 密钥');
  }

  const categories = {};
  let processed = 0;
  const total = bookmarks.length;

  // 创建无法访问的书签文件夹
  const invalidFolder = await chrome.bookmarks.create({
    parentId: '1',
    title: '⚠️ 无法访问的书签'
  });

  for (const bookmark of bookmarks) {
    try {
      updateProgress(
        (processed / total) * 100,
        `正在检查: ${bookmark.title}`,
        processed,
        total
      );

      // 检查页面是否可访问
      const isAccessible = await checkPageAccessibility(bookmark.url);
      
      if (!isAccessible) {
        // 如果页面无法访问，移动到无法访问文件夹
        await chrome.bookmarks.create({
          parentId: invalidFolder.id,
          title: bookmark.title,
          url: bookmark.url
        });
        await chrome.bookmarks.remove(bookmark.id);
        processed++;
        continue;
      }

      updateProgress(
        (processed / total) * 100,
        `正在分类: ${bookmark.title}`,
        processed,
        total
      );

      const [mainCategory, subCategory] = await getDetailedCategory(bookmark, apiKey);
      
      // 处理主分类
      if (!categories[mainCategory]) {
        categories[mainCategory] = {
          folder: await chrome.bookmarks.create({
            parentId: '1', // 直接在书签栏创建
            title: mainCategory
          }),
          subCategories: {}
        };
      }

      // 处理子分类
      if (subCategory) {
        if (!categories[mainCategory].subCategories[subCategory]) {
          categories[mainCategory].subCategories[subCategory] = await chrome.bookmarks.create({
            parentId: categories[mainCategory].folder.id,
            title: subCategory
          });
        }
        // 创建新书签
        await chrome.bookmarks.create({
          parentId: categories[mainCategory].subCategories[subCategory].id,
          title: bookmark.title,
          url: bookmark.url
        });
      } else {
        // 如果没有子分类，直接创建在主分类文件夹下
        await chrome.bookmarks.create({
          parentId: categories[mainCategory].folder.id,
          title: bookmark.title,
          url: bookmark.url
        });
      }
      
      // 删除原始书签
      await chrome.bookmarks.remove(bookmark.id);
      
      processed++;
    } catch (error) {
      console.error('处理错误:', error);
      continue;
    }
  }

  // 如果无法访问文件夹为空，则删除它
  const invalidFolderContent = await chrome.bookmarks.getChildren(invalidFolder.id);
  if (invalidFolderContent.length === 0) {
    await chrome.bookmarks.remove(invalidFolder.id);
  }

  // 清理空文件夹
  await cleanEmptyFolders();

  return categories;
}

// 添加清理空文件夹的功能
async function cleanEmptyFolders() {
  const bookmarks = await chrome.bookmarks.getTree();
  await cleanEmptyFoldersRecursive(bookmarks[0]);
}

async function cleanEmptyFoldersRecursive(node) {
  if (node.children) {
    // 先处理子文件夹
    for (const child of [...node.children]) {
      if (child.children) {
        await cleanEmptyFoldersRecursive(child);
      }
    }
    
    // 如果当前文件夹为空且不是根文件夹，则删除
    const currentNode = await chrome.bookmarks.get(node.id);
    if (currentNode[0].children?.length === 0 && node.id !== '0' && node.id !== '1' && node.id !== '2') {
      await chrome.bookmarks.remove(node.id);
    }
  }
}

async function getDetailedCategory(bookmark, apiKey) {
  const prompt = `分析以下网页的标题和URL，返回两级分类（用|分隔，例如：技术|编程 或 购物|电子产品），分类名称要简短精确：
标题: ${bookmark.title}
URL: ${bookmark.url}
要求：
1. 第一级分类要笼统（如：技术、生活、教育、购物等）
2. 第二级分类要具体（如：编程、美食、课程、数码等）
3. 分类名称必须是中文
4. 只返回分类名称，不要其他解释
示例返回格式：技术|编程`;

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=' + apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 20,
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || '请求失败');
    }

    const data = await response.json();
    const categories = data.candidates[0].content.parts[0].text.trim().split('|');
    return [
      categories[0].trim(),
      categories[1]?.trim() || null
    ];
  } catch (error) {
    console.error('Gemini API请求错误:', error);
    throw new Error('AI分类请求失败');
  }
}

// 添加用于设置API密钥的方法
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setApiKey') {
    chrome.storage.sync.set({ apiKey: request.apiKey })
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

// 添加检查页面可访问性的函数
async function checkPageAccessibility(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-cache',
      timeout: 5000 // 5秒超时
    });
    
    // 由于 no-cors 模式的限制，我们只能通过是否抛出异常来判断
    return true;
  } catch (error) {
    // 如果发生错误（超时、网络错误等），认为页面不可访问
    return false;
  }
}

// 添加清理重复书签的功能
async function cleanDuplicateBookmarks() {
  try {
    const bookmarks = await chrome.bookmarks.getTree();
    const allBookmarks = await getAllBookmarks(bookmarks);
    
    // 用于存储已见过的URL
    const urlMap = new Map();
    // 用于存储重复的书签
    const duplicates = [];
    // 用于存储唯一的书签
    const unique = [];
    
    // 首次遍历，找出所有重复项
    for (const bookmark of allBookmarks) {
      // 标准化 URL（移除尾部斜杠等）
      const normalizedUrl = normalizeUrl(bookmark.url);
      
      if (!urlMap.has(normalizedUrl)) {
        urlMap.set(normalizedUrl, {
          original: bookmark,
          duplicates: []
        });
        unique.push(bookmark);
      } else {
        urlMap.get(normalizedUrl).duplicates.push(bookmark);
        duplicates.push(bookmark);
      }
    }

    // 创建重复书签文件夹
    const duplicateFolder = await chrome.bookmarks.create({
      parentId: '1',
      title: '🔄 重复的书签'
    });

    // 移动重复的书签到重复文件夹
    let processed = 0;
    const total = duplicates.length;

    for (const duplicate of duplicates) {
      try {
        // 更新进度
        chrome.runtime.sendMessage({
          action: 'updateProgress',
          progress: (processed / total) * 100,
          status: `正在处理重复书签: ${duplicate.title}`,
          processed: processed,
          total: total
        });

        // 移动到重复文件夹
        await chrome.bookmarks.move(duplicate.id, {
          parentId: duplicateFolder.id
        });
        
        processed++;
      } catch (error) {
        console.error('移动书签失败:', error);
      }
    }

    return {
      success: true,
      message: `已找到 ${duplicates.length} 个重复书签，已移动到"重复的书签"文件夹`
    };
  } catch (error) {
    throw new Error('清理重复书签失败: ' + error.message);
  }
}

// 获取所有书签
async function getAllBookmarks(nodes) {
  let bookmarks = [];
  for (const node of nodes) {
    if (node.children) {
      bookmarks = bookmarks.concat(await getAllBookmarks(node.children));
    } else if (node.url) {
      bookmarks.push(node);
    }
  }
  return bookmarks;
}

// 标准化 URL
function normalizeUrl(url) {
  try {
    // 创建 URL 对象以标准化 URL
    const urlObj = new URL(url);
    // 移除末尾的斜杠
    let normalized = urlObj.origin + urlObj.pathname.replace(/\/$/, '');
    // 添加查询参数（如果有）
    if (urlObj.search) {
      normalized += urlObj.search;
    }
    // 添加哈希（如果有）
    if (urlObj.hash) {
      normalized += urlObj.hash;
    }
    return normalized.toLowerCase();
  } catch (e) {
    // 如果 URL 无效，返回原始 URL
    return url.toLowerCase();
  }
}

// 修改 manifest.json 中的权限
const manifestUpdates = {
  "permissions": [
    "bookmarks",
    "storage",
    "webRequest"
  ],
  "host_permissions": [
    "https://generativelanguage.googleapis.com/*",
    "<all_urls>"  // 需要添加此权限���检查页面可访问性
  ]
};

// 修改更新进度的方法
function updateProgress(progress, status, processed, total) {
  classificationState = {
    isRunning: true,
    progress,
    status,
    processed,
    total
  };

  // 广播进度更新给所有打开的 popup
  chrome.runtime.sendMessage({
    action: 'updateProgress',
    progress,
    status,
    processed,
    total
  }).catch(() => {
    // 忽略错误，这可能是因为没有活动的 popup
  });
}
  