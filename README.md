# AI 书签分类助手

一个 Chrome 扩展，使用 Google Gemini AI 智能分析并自动分类您的浏览器书签，让书签管理更轻松高效。

## 功能特点

- 🤖 AI 智能分类：使用 Google Gemini AI 自动分析书签内容并进行分类
- 📂 二级分类：支持主分类和子分类的两级分类结构
- 🔍 无效链接检测：自动检测并归类无法访问的书签
- 🔄 重复书签清理：智能识别并整理重复的书签
- 📱 文件夹管理：支持一键打散所有文件夹
- 🔑 安全可靠：API 密钥本地存储，确保安全性

## 安装使用

1. 下载扩展
   - 克隆仓库到本地
   ```bash
   git clone https://github.com/your-username/bookmark-ai-organizer.git
   ```
   - 或直接下载 ZIP 文件并解压

2. 安装扩展
   - 打开 Chrome 浏览器，访问 `chrome://extensions/`
   - 开启右上角的"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目文件夹

3. 配置 API
   - 点击工具栏中的扩展图标
   - 按照教程申请 Google Gemini API 密钥
   - 将密钥填入并保存

4. 开始使用
   - 点击"开始智能分类"进行书签分类
   - 使用"打散所有文件夹"重置分类
   - 使用"清理重复书签"整理重复内容

## 环境要求

- Chrome 浏览器 88 或更高版本
- Google Gemini API 密钥（可免费申请）

## 技术栈

- Chrome Extension API
- Google Gemini AI API
- JavaScript (ES6+)
- HTML5 & CSS3

## 注意事项

- 首次使用需要配置 Google Gemini API 密钥
- API 有每分钟 60 次的免费使用限制
- 建议在分类前备份重要书签
- 分类过程中请勿关闭浏览器

## 许可证

本项目采用 Apache License 2.0 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情