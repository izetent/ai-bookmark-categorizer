// 添加全局状态管理
let classificationState = {
  isRunning: false,
  progress: 0,
  processed: 0,
  total: 0,
  status: "",
  result: null,
};

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "classifyBookmarks") {
    // 如果已经在运行，返回当前状态
    if (classificationState.isRunning) {
      sendResponse({
        isRunning: true,
        progress: classificationState.progress,
        status: classificationState.status,
        processed: classificationState.processed,
        total: classificationState.total,
      });
      return true;
    }

    // 开始新的分类任务
    classificationState.isRunning = true;
    classifyBookmarks(request.bookmarks, request.settings || {})
      .then((result) => {
        classificationState.isRunning = false;
        classificationState.result = result;
        sendResponse(result);
      })
      .catch((error) => {
        classificationState.isRunning = false;
        sendResponse({ error: error.message });
      });
    return true;
  } else if (request.action === "flattenFolders") {
    flattenAllFolders()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  } else if (request.action === "cleanDuplicates") {
    cleanDuplicateBookmarks()
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
        })
      );
    return true;
  } else if (request.action === "setApiKey") {
    chrome.storage.sync
      .set({ apiKey: request.apiKey })
      .then(() => sendResponse({ success: true }))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
        })
      );
    return true;
  } else if (request.action === "getClassificationState") {
    // 返回当前状态
    sendResponse(classificationState);
    return true;
  } else if (request.action === "getClassificationResult") {
    // 返回分类结果
    sendResponse(classificationState.result || {});
    return true;
  }
});

// 打散文件夹的功能
async function flattenAllFolders() {
  try {
    const bookmarks = await chrome.bookmarks.getTree();
    await flattenFolderRecursive(bookmarks[0]);
    return { success: true, message: "文件夹打散完成" };
  } catch (error) {
    throw new Error("打散文件夹失败: " + error.message);
  }
}

async function flattenFolderRecursive(node) {
  if (node.children) {
    const children = [...node.children];
    for (const child of children) {
      if (child.children) {
        await flattenFolderRecursive(child);
        for (const bookmark of child.children || []) {
          if (bookmark.url) {
            await chrome.bookmarks.move(bookmark.id, {
              parentId: "1",
            });
          }
        }
        if (child.id !== "1" && child.id !== "2") {
          await chrome.bookmarks.remove(child.id);
        }
      }
    }
  }
}

async function classifyBookmarks(bookmarks, settings = {}) {
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  if (!apiKey) {
    throw new Error("请先设置 DeepSeek API 密钥");
  }

  const categories = {};
  let processed = 0;
  const total = bookmarks.length;
  let invalidFolder = null;

  // 如果需要检查可访问性，创建无法访问的书签文件夹
  if (settings.checkAccessibility !== false) {
    invalidFolder = await chrome.bookmarks.create({
      parentId: "1",
      title: "⚠️ 无法访问的书签",
    });
  }

  // 批量处理书签以提高效率
  const batchSize = 5;
  for (let i = 0; i < bookmarks.length; i += batchSize) {
    const batch = bookmarks.slice(i, i + batchSize);
    const batchPromises = batch.map(async (bookmark, batchIndex) => {
      const globalIndex = i + batchIndex;
      try {
        updateProgress(
          (globalIndex / total) * 100,
          `正在处理: ${bookmark.title}`,
          globalIndex,
          total
        );

        // 检查页面可访问性（如果启用）
        if (settings.checkAccessibility !== false) {
          const isAccessible = await checkPageAccessibility(bookmark.url);

          if (!isAccessible && invalidFolder) {
            await chrome.bookmarks.create({
              parentId: invalidFolder.id,
              title: bookmark.title,
              url: bookmark.url,
            });
            await chrome.bookmarks.remove(bookmark.id);
            return;
          }
        }

        // 使用 DeepSeek AI 进行分类
        const categoryInfo = await getAICategory(bookmark, apiKey, settings);

        // 处理分类结果
        await processBookmarkCategory(
          bookmark,
          categoryInfo,
          categories,
          settings
        );

        // 删除原始书签
        await chrome.bookmarks.remove(bookmark.id);
      } catch (error) {
        console.error("处理书签错误:", error);
        // 如果分类失败，移动到"未分类"文件夹
        await handleUnclassifiedBookmark(bookmark, categories);
      }
    });

    await Promise.all(batchPromises);
    processed += batch.length;
  }

  // 清理空的无法访问文件夹
  if (invalidFolder) {
    const invalidFolderContent = await chrome.bookmarks.getChildren(
      invalidFolder.id
    );
    if (invalidFolderContent.length === 0) {
      await chrome.bookmarks.remove(invalidFolder.id);
    }
  }

  // 清理空文件夹
  await cleanEmptyFolders();

  updateProgress(100, "分类完成", total, total);
  return categories;
}

// 使用 DeepSeek API 获取分类
async function getAICategory(bookmark, apiKey, settings) {
  const prompt = generateClassificationPrompt(bookmark, settings);

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "你是一个专业的书签分类助手。请根据网页标题和URL进行准确的分类，返回JSON格式的结果。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error?.message ||
          `HTTP ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error("AI 返回空响应");
    }

    try {
      return JSON.parse(content);
    } catch (parseError) {
      console.error("JSON解析错误:", parseError, "Content:", content);
      // 如果JSON解析失败，尝试从文本中提取分类信息
      return parseTextResponse(content);
    }
  } catch (error) {
    console.error("DeepSeek API请求错误:", error);
    throw new Error("AI分类请求失败: " + error.message);
  }
}

// 生成分类提示词
function generateClassificationPrompt(bookmark, settings) {
  const {
    classificationStyle,
    customRequirement,
    maxCategories,
    maxSubCategories,
    maxLevels,
    createSubCategories,
    fuzzyClassification,
  } = settings;

  let basePrompt = `请分析以下网页并进行分类：
标题: ${bookmark.title}
URL: ${bookmark.url}

请返回JSON格式的分类结果，包含以下字段：
{
  "mainCategory": "主分类名称",
  "subCategory": "子分类名称（如果需要）",
  "confidence": 分类置信度(0-1),
  "reason": "分类理由"
}`;

  // 模糊分类设置
  if (fuzzyClassification) {
    basePrompt += `\n\n【重要】使用模糊分类模式：只需要大概的分类类型，不要过于精确或细分。`;
  }

  // 根据分类方式调整提示词
  switch (classificationStyle) {
    case "detailed":
      basePrompt += `\n\n分类要求：进行详细分类，尽可能细分到具体的用途和领域。`;
      break;
    case "simple":
      basePrompt += `\n\n分类要求：进行简单分类，使用宽泛的类别，不要过于细分。`;
      break;
    case "custom":
      if (customRequirement) {
        basePrompt += `\n\n自定义分类要求：${customRequirement}`;
      }
      break;
    default: // smart
      basePrompt += `\n\n分类要求：智能分析网站内容和用途，选择最合适的分类方式。`;
  }

  // 分类数量限制
  if (maxCategories) {
    basePrompt += `\n一级分类数量必须控制在${maxCategories}个以内。`;
  }

  if (createSubCategories && maxSubCategories) {
    basePrompt += `\n每个一级分类下的二级分类数量必须控制在${maxSubCategories}个以内。`;
  }

  // 层级限制
  if (maxLevels) {
    if (maxLevels <= 2) {
      basePrompt += `\n最多只能有${maxLevels}层分类结构，二级分类后不再细分。`;
    } else {
      basePrompt += `\n最多只能有${maxLevels}层分类结构，超过${maxLevels}层的内容应平铺在当前层级。`;
    }
  }

  if (createSubCategories) {
    basePrompt += `\n如果合适，请创建子分类以更好地组织书签。`;
  } else {
    basePrompt += `\n不需要创建子分类，只使用主分类。`;
  }

  basePrompt += `\n\n常见分类参考（仅供参考，可根据实际内容调整）：
- 技术开发（编程、工具、文档）
- 学习资源（教程、课程、参考）
- 新闻媒体（新闻、博客、资讯）
- 社交平台（社交网络、论坛、社区）
- 娱乐休闲（视频、音乐、游戏）
- 购物电商（购物、比价、优惠）
- 生活服务（工具、服务、实用）
- 工作办公（办公、协作、管理）`;

  return basePrompt;
}

// 解析文本响应（备用方案）
function parseTextResponse(content) {
  const lines = content.split("\n");
  let mainCategory = "其他";
  let subCategory = null;

  for (const line of lines) {
    if (line.includes("主分类") || line.includes("mainCategory")) {
      const match = line.match(/[:：](.+)/);
      if (match) mainCategory = match[1].trim();
    }
    if (line.includes("子分类") || line.includes("subCategory")) {
      const match = line.match(/[:：](.+)/);
      if (match) subCategory = match[1].trim();
    }
  }

  return {
    mainCategory,
    subCategory,
    confidence: 0.5,
    reason: "文本解析",
  };
}

// 处理书签分类
async function processBookmarkCategory(
  bookmark,
  categoryInfo,
  categories,
  settings
) {
  const { mainCategory, subCategory } = categoryInfo;
  const { maxCategories, maxSubCategories, maxLevels, createSubCategories } =
    settings;

  // 检查一级分类数量限制
  const currentMainCategoryCount = Object.keys(categories).length;
  let finalMainCategory = mainCategory;

  if (
    maxCategories &&
    currentMainCategoryCount >= maxCategories &&
    !categories[mainCategory]
  ) {
    // 如果超过了一级分类限制，将其归到"其他"分类
    finalMainCategory = "🗂️ 其他";
  }

  // 处理主分类
  if (!categories[finalMainCategory]) {
    categories[finalMainCategory] = {
      folder: await chrome.bookmarks.create({
        parentId: "1",
        title: finalMainCategory,
      }),
      subCategories: {},
      bookmarks: [],
    };
  }

  let targetFolderId;

  // 处理子分类（考虑层级和数量限制）
  if (subCategory && createSubCategories !== false && maxLevels > 1) {
    const currentSubCategoryCount = Object.keys(
      categories[finalMainCategory].subCategories
    ).length;
    let finalSubCategory = subCategory;

    // 检查二级分类数量限制
    if (
      maxSubCategories &&
      currentSubCategoryCount >= maxSubCategories &&
      !categories[finalMainCategory].subCategories[subCategory]
    ) {
      // 如果超过了二级分类限制，直接放在一级分类下
      targetFolderId = categories[finalMainCategory].folder.id;
      categories[finalMainCategory].bookmarks.push(bookmark);
    } else {
      // 创建或使用现有的二级分类
      if (!categories[finalMainCategory].subCategories[finalSubCategory]) {
        const subFolder = await chrome.bookmarks.create({
          parentId: categories[finalMainCategory].folder.id,
          title: finalSubCategory,
        });
        categories[finalMainCategory].subCategories[finalSubCategory] = {
          folder: subFolder,
          bookmarks: [],
        };
      }
      targetFolderId =
        categories[finalMainCategory].subCategories[finalSubCategory].folder.id;
      categories[finalMainCategory].subCategories[
        finalSubCategory
      ].bookmarks.push(bookmark);
    }
  } else {
    // 不创建子分类或已达到最大层级，直接放在主分类下
    targetFolderId = categories[finalMainCategory].folder.id;
    categories[finalMainCategory].bookmarks.push(bookmark);
  }

  // 创建新书签
  await chrome.bookmarks.create({
    parentId: targetFolderId,
    title: bookmark.title,
    url: bookmark.url,
  });
}

// 处理未分类书签
async function handleUnclassifiedBookmark(bookmark, categories) {
  const unclassifiedCategory = "📂 未分类";

  if (!categories[unclassifiedCategory]) {
    categories[unclassifiedCategory] = {
      folder: await chrome.bookmarks.create({
        parentId: "1",
        title: unclassifiedCategory,
      }),
      subCategories: {},
      bookmarks: [],
    };
  }

  await chrome.bookmarks.create({
    parentId: categories[unclassifiedCategory].folder.id,
    title: bookmark.title,
    url: bookmark.url,
  });

  categories[unclassifiedCategory].bookmarks.push(bookmark);

  try {
    await chrome.bookmarks.remove(bookmark.id);
  } catch (error) {
    console.error("删除原书签失败:", error);
  }
}

// 清理空文件夹
async function cleanEmptyFolders() {
  const bookmarks = await chrome.bookmarks.getTree();
  await cleanEmptyFoldersRecursive(bookmarks[0]);
}

async function cleanEmptyFoldersRecursive(node) {
  if (node.children) {
    for (const child of [...node.children]) {
      if (child.children) {
        await cleanEmptyFoldersRecursive(child);
      }
    }

    try {
      const currentNode = await chrome.bookmarks.get(node.id);
      const children = await chrome.bookmarks.getChildren(node.id);
      if (
        children.length === 0 &&
        node.id !== "0" &&
        node.id !== "1" &&
        node.id !== "2"
      ) {
        await chrome.bookmarks.remove(node.id);
      }
    } catch (error) {
      // 忽略删除错误
    }
  }
}

// 检查页面可访问性
async function checkPageAccessibility(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-cache",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    return false;
  }
}

// 清理重复书签功能
async function cleanDuplicateBookmarks() {
  try {
    const bookmarks = await chrome.bookmarks.getTree();
    const allBookmarks = await getAllBookmarks(bookmarks);

    const urlMap = new Map();
    const duplicates = [];

    for (const bookmark of allBookmarks) {
      const normalizedUrl = normalizeUrl(bookmark.url);

      if (!urlMap.has(normalizedUrl)) {
        urlMap.set(normalizedUrl, bookmark);
      } else {
        duplicates.push(bookmark);
      }
    }

    if (duplicates.length === 0) {
      return {
        success: true,
        message: "没有发现重复书签",
      };
    }

    const duplicateFolder = await chrome.bookmarks.create({
      parentId: "1",
      title: "🔄 重复的书签",
    });

    let processed = 0;
    for (const duplicate of duplicates) {
      try {
        await chrome.bookmarks.move(duplicate.id, {
          parentId: duplicateFolder.id,
        });
        processed++;
      } catch (error) {
        console.error("移动书签失败:", error);
      }
    }

    return {
      success: true,
      message: `已找到 ${duplicates.length} 个重复书签，已移动到"重复的书签"文件夹`,
    };
  } catch (error) {
    throw new Error("清理重复书签失败: " + error.message);
  }
}

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

function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    let normalized = urlObj.origin + urlObj.pathname.replace(/\/$/, "");
    if (urlObj.search) normalized += urlObj.search;
    if (urlObj.hash) normalized += urlObj.hash;
    return normalized.toLowerCase();
  } catch (e) {
    return url.toLowerCase();
  }
}

function updateProgress(progress, status, processed, total) {
  classificationState = {
    ...classificationState,
    isRunning: true,
    progress,
    status,
    processed,
    total,
  };

  chrome.runtime
    .sendMessage({
      action: "updateProgress",
      progress,
      status,
      processed,
      total,
    })
    .catch(() => {
      // 忽略错误
    });
}
