// 全局状态管理
const AppState = {
  isClassifying: false,
  selectedFolderId: null,
  progressUpdateInterval: null,

  // 检查必要的DOM元素是否存在
  checkRequiredElements() {
    const requiredElements = [
      "apiKey",
      "apiStatus",
      "saveApiKey",
      "toggleApiKey",
      "copyApiKey",
      "folderSelect",
      "selectedBookmarks",
      "startBtn",
      "classificationStyle",
      "customRequirement",
      "customRequirementGroup",
      "maxCategories",
      "maxSubCategories",
      "maxLevels",
      "createSubCategories",
      "fuzzyClassification",
      "includeSubfolders",
      "checkAccessibility",
      "progress",
      "status",
      "percentage",
      "processedCount",
      "totalCount",
      "results",
      "categoryList",
    ];

    const missingElements = requiredElements.filter(
      (id) => !document.getElementById(id)
    );

    if (missingElements.length > 0) {
      console.warn("缺失的DOM元素:", missingElements);
      return false;
    }
    return true;
  },

  // 初始化应用状态
  init() {
    if (!this.checkRequiredElements()) {
      console.error("缺少必要的DOM元素，无法初始化");
      return;
    }

    this.bindEvents();
    this.loadBookmarkFolders();
    this.loadSettings();
  },

  // 绑定事件监听器
  bindEvents() {
    // API密钥相关
    document
      .getElementById("saveApiKey")
      .addEventListener("click", this.saveApiKey.bind(this));
    document
      .getElementById("toggleApiKey")
      .addEventListener("click", this.toggleApiKey.bind(this));
    document
      .getElementById("copyApiKey")
      .addEventListener("click", this.copyApiKey.bind(this));

    // 书签操作
    document
      .getElementById("startBtn")
      .addEventListener("click", this.startClassification.bind(this));
    document
      .getElementById("flattenBtn")
      .addEventListener("click", this.flattenFolders.bind(this));
    document
      .getElementById("cleanDuplicatesBtn")
      .addEventListener("click", this.cleanDuplicates.bind(this));

    // 文件夹选择
    document
      .getElementById("folderSelect")
      .addEventListener("change", this.onFolderChange.bind(this));
    document
      .getElementById("refreshFolders")
      .addEventListener("click", this.loadBookmarkFolders.bind(this));

    // 分类设置
    document
      .getElementById("classificationStyle")
      .addEventListener("change", this.onStyleChange.bind(this));
    document
      .getElementById("customRequirement")
      .addEventListener("input", this.saveSettings.bind(this));
    document
      .getElementById("maxCategories")
      .addEventListener("change", this.saveSettings.bind(this));
    document
      .getElementById("maxSubCategories")
      .addEventListener("change", this.saveSettings.bind(this));
    document
      .getElementById("maxLevels")
      .addEventListener("change", this.saveSettings.bind(this));
    document
      .getElementById("createSubCategories")
      .addEventListener("change", this.saveSettings.bind(this));
    document
      .getElementById("fuzzyClassification")
      .addEventListener("change", this.saveSettings.bind(this));
    document
      .getElementById("includeSubfolders")
      .addEventListener("change", this.saveSettings.bind(this));
    document
      .getElementById("checkAccessibility")
      .addEventListener("change", this.saveSettings.bind(this));

    // 教程控制
    document.getElementById("showTutorial").addEventListener("click", () => {
      document.getElementById("tutorial").classList.remove("hidden");
    });
    document.getElementById("closeTutorial").addEventListener("click", () => {
      document.getElementById("tutorial").classList.add("hidden");
    });

    // 链接处理
    document.addEventListener("click", (e) => {
      if (e.target.tagName === "A" && e.target.href) {
        e.preventDefault();
        chrome.tabs.create({ url: e.target.href });
      }
    });
  },

  // 分类方式变化处理
  onStyleChange() {
    const style = document.getElementById("classificationStyle").value;
    const customGroup = document.getElementById("customRequirementGroup");

    if (style === "custom") {
      customGroup.style.display = "block";
    } else {
      customGroup.style.display = "none";
    }

    this.saveSettings();
  },

  // 保存设置
  async saveSettings() {
    const settings = {
      classificationStyle: document.getElementById("classificationStyle").value,
      customRequirement: document.getElementById("customRequirement").value,
      maxCategories: parseInt(document.getElementById("maxCategories").value),
      maxSubCategories: parseInt(
        document.getElementById("maxSubCategories").value
      ),
      maxLevels: parseInt(document.getElementById("maxLevels").value),
      createSubCategories: document.getElementById("createSubCategories")
        .checked,
      fuzzyClassification: document.getElementById("fuzzyClassification")
        .checked,
      includeSubfolders: document.getElementById("includeSubfolders").checked,
      checkAccessibility: document.getElementById("checkAccessibility").checked,
    };

    try {
      await chrome.storage.sync.set({ classificationSettings: settings });
    } catch (error) {
      console.error("保存设置失败:", error);
    }
  },

  // 加载设置
  async loadSettings() {
    try {
      const { classificationSettings } = await chrome.storage.sync.get(
        "classificationSettings"
      );

      if (classificationSettings) {
        document.getElementById("classificationStyle").value =
          classificationSettings.classificationStyle || "smart";
        document.getElementById("customRequirement").value =
          classificationSettings.customRequirement || "";
        document.getElementById("maxCategories").value =
          classificationSettings.maxCategories || 8;
        document.getElementById("maxSubCategories").value =
          classificationSettings.maxSubCategories || 8;
        document.getElementById("maxLevels").value =
          classificationSettings.maxLevels || 3;
        document.getElementById("createSubCategories").checked =
          classificationSettings.createSubCategories !== false;
        document.getElementById("fuzzyClassification").checked =
          classificationSettings.fuzzyClassification !== false;
        document.getElementById("includeSubfolders").checked =
          classificationSettings.includeSubfolders !== false;
        document.getElementById("checkAccessibility").checked =
          classificationSettings.checkAccessibility !== false;

        // 触发样式变化处理
        this.onStyleChange();
      }
    } catch (error) {
      console.error("加载设置失败:", error);
    }
  },

  // 加载书签文件夹
  async loadBookmarkFolders() {
    try {
      const bookmarkTree = await chrome.bookmarks.getTree();
      const folderSelect = document.getElementById("folderSelect");

      if (!folderSelect) {
        console.warn("folderSelect element not found");
        return;
      }

      folderSelect.innerHTML = '<option value="">选择要分类的文件夹</option>';

      const folders = this.extractFolders(bookmarkTree);

      folders.forEach((folder) => {
        if (folder.bookmarkCount > 0) {
          const option = document.createElement("option");
          option.value = folder.id;
          // 显示总书签数（包括子文件夹中的书签）
          option.textContent = `${folder.title} (共 ${folder.bookmarkCount} 个书签)`;
          option.dataset.bookmarkCount = folder.bookmarkCount;
          option.dataset.directBookmarkCount = folder.directBookmarkCount;
          folderSelect.appendChild(option);
        }
      });

      this.updateSelectionStatus();
    } catch (error) {
      console.error("加载书签文件夹失败:", error);
      this.showStatus("加载文件夹失败: " + error.message, "error");
    }
  },

  // 提取文件夹信息
  extractFolders(nodes, prefix = "") {
    const folders = [];

    const traverse = (nodeList, currentPrefix) => {
      for (const node of nodeList) {
        if (node.children) {
          const directBookmarkCount = this.countDirectBookmarks(node);
          const totalBookmarkCount = this.countBookmarks(node);

          if (totalBookmarkCount > 0) {
            folders.push({
              id: node.id,
              title: currentPrefix + node.title,
              bookmarkCount: totalBookmarkCount,
              directBookmarkCount: directBookmarkCount,
            });
          }

          if (node.children.length > 0) {
            traverse(node.children, currentPrefix + node.title + " → ");
          }
        }
      }
    };

    traverse(nodes, prefix);
    return folders;
  },

  // 计算文件夹中的直接书签数量
  countDirectBookmarks(folder) {
    let count = 0;
    if (folder.children) {
      for (const child of folder.children) {
        if (child.url) {
          count++;
        }
      }
    }
    return count;
  },

  // 计算文件夹中的所有书签数量
  countBookmarks(folder) {
    let count = 0;

    const traverse = (node) => {
      if (node.children) {
        node.children.forEach(traverse);
      } else if (node.url) {
        count++;
      }
    };

    traverse(folder);
    return count;
  },

  // 文件夹选择变化处理
  onFolderChange(event) {
    const selectedOption = event.target.selectedOptions[0];

    if (selectedOption && selectedOption.value) {
      this.selectedFolderId = selectedOption.value;
    } else {
      this.selectedFolderId = null;
    }

    this.updateSelectionStatus();
  },

  // 更新选择状态显示
  updateSelectionStatus() {
    const selectedBookmarksElement =
      document.getElementById("selectedBookmarks");
    const startBtn = document.getElementById("startBtn");
    const folderSelect = document.getElementById("folderSelect");

    if (!selectedBookmarksElement || !startBtn || !folderSelect) return;

    if (this.selectedFolderId) {
      const selectedOption = folderSelect.selectedOptions[0];
      const totalBookmarks = selectedOption.dataset.bookmarkCount;
      const directBookmarks = selectedOption.dataset.directBookmarkCount || 0;

      selectedBookmarksElement.textContent = `已选择: ${selectedOption.textContent}`;

      // 如果有子文件夹中的书签，显示详细信息
      if (totalBookmarks > directBookmarks) {
        selectedBookmarksElement.textContent += ` (包含子文件夹)`;
      }

      startBtn.disabled = false;
    } else {
      selectedBookmarksElement.textContent = "请先选择文件夹";
      startBtn.disabled = true;
    }
  },

  // 开始分类
  async startClassification() {
    if (this.isClassifying) {
      this.showStatus("分类正在进行中...", "warning");
      return;
    }

    if (!this.selectedFolderId) {
      this.showStatus("请先选择要分类的文件夹", "error");
      return;
    }

    // 获取分类设置
    const settings = await this.getClassificationSettings();

    this.isClassifying = true;
    this.resetProgress();
    this.showProgress();

    try {
      const selectedFolder = await chrome.bookmarks.getSubTree(
        this.selectedFolderId
      );

      if (!selectedFolder || selectedFolder.length === 0) {
        throw new Error("无法获取选中的文件夹");
      }

      // 根据设置选择获取书签的方式
      let bookmarks;
      if (settings.includeSubfolders !== false) {
        // 获取文件夹中的所有书签（包括子文件夹中的书签）
        bookmarks = this.getAllBookmarksInFolder(selectedFolder[0]);
      } else {
        // 只获取直接书签
        bookmarks = this.getDirectBookmarks(selectedFolder[0]);
      }

      if (bookmarks.length === 0) {
        const errorMsg =
          settings.includeSubfolders !== false
            ? "选中的文件夹中没有书签"
            : "选中的文件夹中没有直接书签";
        throw new Error(errorMsg);
      }

      const bookmarkTypeText =
        settings.includeSubfolders !== false
          ? "个书签（包含子文件夹）"
          : "个直接书签";

      this.updateProgress(
        5,
        `准备使用 DeepSeek AI 分类 ${bookmarks.length} ${bookmarkTypeText}...`
      );

      this.startProgressMonitoring();

      const result = await chrome.runtime.sendMessage({
        action: "classifyBookmarks",
        bookmarks: bookmarks,
        settings: settings,
        folderId: this.selectedFolderId,
        folderTitle: selectedFolder[0].title,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.isRunning) {
        this.displayResults(result);
        this.updateProgress(100, "分类完成");
        this.stopProgressMonitoring();
        this.isClassifying = false;
      }
    } catch (error) {
      console.error("分类过程出错:", error);
      this.showStatus("分类过程出错: " + error.message, "error");
      this.stopProgressMonitoring();
      this.isClassifying = false;
    }
  },

  // 获取分类设置
  async getClassificationSettings() {
    const { classificationSettings } = await chrome.storage.sync.get(
      "classificationSettings"
    );

    return {
      classificationStyle: document.getElementById("classificationStyle").value,
      customRequirement: document.getElementById("customRequirement").value,
      maxCategories: parseInt(document.getElementById("maxCategories").value),
      maxSubCategories: parseInt(
        document.getElementById("maxSubCategories").value
      ),
      maxLevels: parseInt(document.getElementById("maxLevels").value),
      createSubCategories: document.getElementById("createSubCategories")
        .checked,
      fuzzyClassification: document.getElementById("fuzzyClassification")
        .checked,
      includeSubfolders: document.getElementById("includeSubfolders").checked,
      checkAccessibility: document.getElementById("checkAccessibility").checked,
      ...classificationSettings,
    };
  },

  // 获取文件夹的直接书签（不包括子文件夹）
  getDirectBookmarks(folder) {
    const bookmarks = [];

    if (folder.children) {
      for (const child of folder.children) {
        if (child.url) {
          bookmarks.push({
            id: child.id,
            title: child.title,
            url: child.url,
            parentId: folder.id,
          });
        }
      }
    }

    return bookmarks;
  },

  // 获取文件夹中的所有书签（包括子文件夹中的书签）
  getAllBookmarksInFolder(folder) {
    const bookmarks = [];

    const traverse = (node) => {
      if (node.children) {
        for (const child of node.children) {
          if (child.url) {
            // 这是一个书签
            bookmarks.push({
              id: child.id,
              title: child.title,
              url: child.url,
              parentId: node.id,
            });
          } else if (child.children) {
            // 这是一个文件夹，递归处理
            traverse(child);
          }
        }
      }
    };

    traverse(folder);
    return bookmarks;
  },

  // 开始进度监控
  startProgressMonitoring() {
    this.progressUpdateInterval = setInterval(async () => {
      try {
        const state = await chrome.runtime.sendMessage({
          action: "getClassificationState",
        });

        if (state && state.isRunning) {
          this.updateProgress(
            state.progress || 0,
            state.status || "处理中...",
            state.processed || 0,
            state.total || 0
          );
        } else {
          this.stopProgressMonitoring();
          this.updateProgress(100, "分类完成");

          const result = await chrome.runtime.sendMessage({
            action: "getClassificationResult",
          });

          if (result && !result.error) {
            this.displayResults(result);
          }

          await this.loadBookmarkFolders();
          this.isClassifying = false;
        }
      } catch (error) {
        console.error("获取进度状态失败:", error);
      }
    }, 1000);
  },

  // 停止进度监控
  stopProgressMonitoring() {
    if (this.progressUpdateInterval) {
      clearInterval(this.progressUpdateInterval);
      this.progressUpdateInterval = null;
    }
    this.isClassifying = false;
  },

  // 显示进度
  showProgress() {
    const progress = document.getElementById("progress");
    if (progress) {
      progress.classList.remove("hidden");
    }
  },

  // 重置进度
  resetProgress() {
    const progressFill = document.querySelector(".progress-fill");
    const percentage = document.getElementById("percentage");
    const processedCount = document.getElementById("processedCount");
    const totalCount = document.getElementById("totalCount");

    if (progressFill) progressFill.style.width = "0%";
    if (percentage) percentage.textContent = "0%";
    if (processedCount) processedCount.textContent = "0";
    if (totalCount) totalCount.textContent = "0";
  },

  // 更新进度
  updateProgress(progressValue, statusText, processed = 0, total = 0) {
    const progressFill = document.querySelector(".progress-fill");
    const percentage = document.getElementById("percentage");
    const status = document.getElementById("status");
    const processedCount = document.getElementById("processedCount");
    const totalCount = document.getElementById("totalCount");

    if (progressFill) {
      progressFill.style.transition = "width 0.3s ease";
      progressFill.style.width = `${Math.min(progressValue, 100)}%`;
    }
    if (percentage) {
      percentage.textContent = `${Math.round(Math.min(progressValue, 100))}%`;
    }
    if (status) {
      status.textContent = statusText;
    }
    if (processed > 0 && processedCount) {
      processedCount.textContent = processed;
    }
    if (total > 0 && totalCount) {
      totalCount.textContent = total;
    }
  },

  // 显示状态消息
  showStatus(message, type = "info") {
    const status = document.getElementById("status");
    if (status) {
      status.textContent = message;
      status.className = `status ${type}`;
    }
  },

  // 显示分类结果
  displayResults(categories) {
    const results = document.getElementById("results");
    const categoryList = document.getElementById("categoryList");

    if (!results || !categoryList) return;

    results.classList.remove("hidden");
    categoryList.innerHTML = "";

    if (!categories || typeof categories !== "object") {
      categoryList.innerHTML = "<li>没有分类结果</li>";
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const [mainCategory, data] of Object.entries(categories)) {
      const li = document.createElement("li");
      const subCategories = data.subCategories || {};

      let subCategoryHtml = "";
      let totalBookmarks = 0;

      for (const [subName, subData] of Object.entries(subCategories)) {
        const bookmarkCount = subData.bookmarks ? subData.bookmarks.length : 0;
        totalBookmarks += bookmarkCount;
        subCategoryHtml += `
          <li class="sub-category">
            <h5>${this.escapeHtml(subName)} (${bookmarkCount})</h5>
          </li>
        `;
      }

      // 添加主分类直接包含的书签数量
      if (data.bookmarks) {
        totalBookmarks += data.bookmarks.length;
      }

      li.innerHTML = `
        <h4>${this.escapeHtml(mainCategory)} (${totalBookmarks})</h4>
        <ul class="sub-categories">
          ${subCategoryHtml}
        </ul>
      `;
      fragment.appendChild(li);
    }

    categoryList.appendChild(fragment);
  },

  // HTML转义
  escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  // API密钥保存
  async saveApiKey() {
    const apiKey = document.getElementById("apiKey").value.trim();
    const apiStatus = document.getElementById("apiStatus");

    if (!apiKey) {
      apiStatus.textContent = "请输入API密钥";
      apiStatus.className = "status error";
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: "setApiKey",
        apiKey: apiKey,
      });

      if (response.success) {
        apiStatus.textContent = "密钥保存成功";
        apiStatus.className = "status success";
        document.getElementById("apiKey").value = "";
      } else {
        throw new Error(response.error || "保存失败");
      }
    } catch (error) {
      apiStatus.textContent = error.message;
      apiStatus.className = "status error";
    }
  },

  // 切换密钥显示
  toggleApiKey() {
    const apiKeyInput = document.getElementById("apiKey");
    const toggleBtn = document.getElementById("toggleApiKey");

    if (apiKeyInput.type === "password") {
      apiKeyInput.type = "text";
      toggleBtn.textContent = "🔒";
      toggleBtn.title = "隐藏密钥";
    } else {
      apiKeyInput.type = "password";
      toggleBtn.textContent = "👁️";
      toggleBtn.title = "显示密钥";
    }
  },

  // 复制API密钥
  async copyApiKey() {
    const apiKeyInput = document.getElementById("apiKey");
    const currentKey = apiKeyInput.value;

    if (!currentKey) {
      const { apiKey } = await chrome.storage.sync.get("apiKey");
      if (apiKey) {
        await this.copyToClipboard(apiKey);
        this.showCopyTooltip("密钥已复制");
      } else {
        this.showCopyTooltip("没有保存的密钥");
      }
    } else {
      await this.copyToClipboard(currentKey);
      this.showCopyTooltip("密钥已复制");
    }
  },

  // 复制到剪贴板
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  },

  // 显示复制提示
  showCopyTooltip(message) {
    const tooltip = document.createElement("div");
    tooltip.className = "copy-tooltip";
    tooltip.textContent = message;

    const copyBtn = document.getElementById("copyApiKey");
    if (copyBtn) {
      const rect = copyBtn.getBoundingClientRect();
      tooltip.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.bottom + 5}px;
        z-index: 1000;
        background: #333;
        color: white;
        padding: 5px 10px;
        border-radius: 4px;
        font-size: 12px;
      `;

      document.body.appendChild(tooltip);

      setTimeout(() => {
        if (document.body.contains(tooltip)) {
          document.body.removeChild(tooltip);
        }
      }, 1500);
    }
  },

  // 检查API密钥
  async checkApiKey() {
    try {
      const { apiKey } = await chrome.storage.sync.get("apiKey");
      const apiStatus = document.getElementById("apiStatus");
      const apiKeyInput = document.getElementById("apiKey");

      if (apiKey && apiStatus && apiKeyInput) {
        apiStatus.textContent = "已设置API密钥";
        apiStatus.className = "status success";
        // 不在输入框中显示完整的API密钥，只显示部分用于确认
        apiKeyInput.value = apiKey.substring(0, 8) + "...";
        apiKeyInput.placeholder = "API密钥已设置";
      }
    } catch (error) {
      console.error("检查API密钥失败:", error);
    }
  },

  // 检查分类状态
  async checkClassificationState() {
    try {
      const result = await chrome.runtime.sendMessage({
        action: "getClassificationState",
      });

      if (result && result.isRunning) {
        this.isClassifying = true;
        this.showProgress();
        this.updateProgress(
          result.progress || 0,
          result.status || "处理中...",
          result.processed || 0,
          result.total || 0
        );
        this.startProgressMonitoring();
      }
    } catch (error) {
      console.error("检查分类状态失败:", error);
    }
  },

  // 打散文件夹
  async flattenFolders() {
    const status = document.getElementById("status");
    const progress = document.getElementById("progress");

    if (progress) progress.classList.remove("hidden");
    if (status) status.textContent = "正在打散文件夹...";

    try {
      const result = await chrome.runtime.sendMessage({
        action: "flattenFolders",
      });

      if (result.success) {
        if (status) status.textContent = result.message;
        await this.loadBookmarkFolders();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      if (status) status.textContent = "操作失败: " + error.message;
    }
  },

  // 清理重复书签
  async cleanDuplicates() {
    const progress = document.getElementById("progress");
    const status = document.getElementById("status");
    const progressFill = document.querySelector(".progress-fill");

    try {
      this.showProgress();
      this.resetProgress();
      if (status) status.textContent = "正在查找重复书签...";

      const result = await chrome.runtime.sendMessage({
        action: "cleanDuplicates",
      });

      if (result && result.success) {
        if (status) status.textContent = result.message;
        if (progressFill) progressFill.style.width = "100%";
        const percentage = document.getElementById("percentage");
        if (percentage) percentage.textContent = "100%";
        await this.loadBookmarkFolders();
      } else {
        throw new Error(result?.error || "清理失败");
      }
    } catch (error) {
      console.error("清理重复书签时出错:", error);
      if (status)
        status.textContent = "清理失败: " + (error.message || "未知错误");
      if (progressFill) progressFill.style.width = "0%";
      const percentage = document.getElementById("percentage");
      if (percentage) percentage.textContent = "0%";
    }
  },
};

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", async () => {
  await AppState.checkApiKey();
  await AppState.checkClassificationState();
  AppState.init();
});

// 页面卸载时清理
window.addEventListener("beforeunload", () => {
  AppState.stopProgressMonitoring();
});
