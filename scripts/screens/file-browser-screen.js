import { BaseScreen } from "./base-screen.js";
import { emitSocket } from "../module.js";
import { SoundManager } from "../effects/sounds.js";

export class FileBrowserScreen extends BaseScreen {
  static get screenId() {
    return "fileBrowser";
  }
  static get screenName() {
    return "File Browser";
  }
  get hasInput() {
    return false;
  }
  get template() {
    return "modules/interactive-terminal/templates/screens/file-browser.hbs";
  }

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.filesystem = config.filesystem || {
      id: "root",
      name: "root",
      type: "folder",
      hidden: false,
      children: [],
    };
    this.currentPath = config.currentPath || [];
    this.openFile = config.openFile || null;
    this.navigationLocked = config.navigationLocked || false;
  }

  deactivate() {
    if (this._abortController) this._abortController.abort();
    this._abortController = null;
    super.deactivate();
  }

  getData() {
    return {
      ...super.getData(),
      navigationLocked: this.navigationLocked,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    if (this._abortController) this._abortController.abort();
    this._abortController = new AbortController();
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this.activateListeners(container);
    this._renderView();
  }

  activateListeners(container) {
    const signal = this._abortController?.signal;
    container.addEventListener(
      "click",
      (e) => {
        const entry = e.target.closest(".fb-entry");
        if (entry) {
          if (this.navigationLocked && !game.user.isGM) return;
          if (entry.classList.contains("fb-folder")) {
            this.navigateToFolder(entry.dataset.name);
          } else if (entry.classList.contains("fb-file")) {
            this.openFileById(entry.dataset.id);
          }
          return;
        }

        const breadcrumb = e.target.closest(".fb-breadcrumb");
        if (breadcrumb) {
          if (this.navigationLocked && !game.user.isGM) return;
          const index = parseInt(breadcrumb.dataset.index);
          this.navigateToBreadcrumb(index);
          return;
        }

        if (e.target.closest(".fb-back-btn")) {
          if (this.navigationLocked && !game.user.isGM) return;
          this.goBack();
        }
      },
      { signal },
    );
  }

  _renderView() {
    if (!this.element) return;
    const breadcrumbBar = this.element.querySelector(".fb-breadcrumb-bar");
    const content = this.element.querySelector(".fb-content");
    if (!breadcrumbBar || !content) return;

    this._renderBreadcrumbs(breadcrumbBar);

    if (this.openFile) {
      this._renderFileView(content);
    } else {
      this._renderFolderListing(content);
    }

    const lockIndicator = this.element.querySelector(".fb-lock-indicator");
    if (lockIndicator) {
      lockIndicator.style.display = this.navigationLocked && !game.user.isGM ? "block" : "none";
    }

    const navBack = this.element.querySelector(".fb-nav-back");
    if (navBack) {
      const canGoBack = this.currentPath.length > 0 || this.openFile;
      navBack.style.display = canGoBack ? "inline-block" : "none";
    }
  }

  _renderBreadcrumbs(bar) {
    bar.innerHTML = "";
    const root = document.createElement("span");
    root.classList.add("fb-breadcrumb");
    root.dataset.index = "-1";
    root.textContent = "/";
    bar.appendChild(root);

    this.currentPath.forEach((name, i) => {
      const sep = document.createElement("span");
      sep.classList.add("fb-breadcrumb-sep");
      sep.textContent = "/";
      bar.appendChild(sep);

      const crumb = document.createElement("span");
      crumb.classList.add("fb-breadcrumb");
      crumb.dataset.index = String(i);
      crumb.textContent = name;
      bar.appendChild(crumb);
    });
  }

  _renderFolderListing(content) {
    content.innerHTML = "";
    const folder = this._getNodeAtPath(this.currentPath);
    if (!folder) {
      this.currentPath = [];
      this._renderView();
      return;
    }

    const children = this._getVisibleChildren(folder);
    if (children.length === 0) {
      const empty = document.createElement("div");
      empty.classList.add("terminal-line", "term-dim");
      empty.textContent = "< empty >";
      content.appendChild(empty);
      return;
    }

    const sorted = [...children].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const node of sorted) {
      const entry = document.createElement("div");
      entry.classList.add("fb-entry", node.type === "folder" ? "fb-folder" : "fb-file");
      if (node.hidden) entry.classList.add("fb-hidden");
      entry.dataset.name = node.name;
      entry.dataset.id = node.id;

      const icon = document.createElement("i");
      icon.classList.add("fas", node.type === "folder" ? "fa-folder" : "fa-file-alt");
      entry.appendChild(icon);

      const name = document.createElement("span");
      name.classList.add("fb-name");
      name.textContent = node.name;
      entry.appendChild(name);

      if (node.hidden && game.user.isGM) {
        const hiddenIcon = document.createElement("i");
        hiddenIcon.classList.add("fas", "fa-eye-slash", "fb-hidden-icon");
        entry.appendChild(hiddenIcon);
      }

      content.appendChild(entry);
    }
  }

  _renderFileView(content) {
    content.innerHTML = "";
    const file = this._findNodeById(this.filesystem, this.openFile);

    if (!file) {
      this.openFile = null;
      this._renderView();
      return;
    }

    const header = document.createElement("div");
    header.classList.add("fb-file-header");

    const backBtn = document.createElement("button");
    backBtn.classList.add("fb-back-btn");
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Back';
    header.appendChild(backBtn);

    const fileName = document.createElement("span");
    fileName.classList.add("fb-file-name");
    fileName.textContent = file.name;
    header.appendChild(fileName);

    content.appendChild(header);

    if (file.contentType === "image" && file.imagePath) {
      const imgContainer = document.createElement("div");
      imgContainer.classList.add("fb-file-content", "fb-image-container");
      const img = document.createElement("img");
      img.src = file.imagePath;
      img.classList.add("fb-image");
      img.alt = file.name;
      imgContainer.appendChild(img);
      content.appendChild(imgContainer);
    } else {
      const fileContent = document.createElement("div");
      fileContent.classList.add("fb-file-content");
      fileContent.textContent = file.content || "";
      content.appendChild(fileContent);
    }
  }

  _getNodeAtPath(path) {
    let node = this.filesystem;
    for (const name of path) {
      if (!node.children) return null;
      const child = node.children.find((c) => c.name === name && c.type === "folder");
      if (!child) return null;
      node = child;
    }
    return node;
  }

  _getVisibleChildren(folderNode) {
    if (!folderNode.children) return [];
    if (game.user.isGM) return folderNode.children;
    return folderNode.children.filter((c) => !c.hidden);
  }

  _findNodeById(node, id) {
    if (node.id === id) return node;
    if (node.children) {
      for (const child of node.children) {
        const found = this._findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  navigateToFolder(folderName) {
    this.currentPath.push(folderName);
    this.openFile = null;
    this._renderView();
    SoundManager.play("keystroke");
    emitSocket("fileBrowserNavigate", this.terminal.terminalId, {
      currentPath: [...this.currentPath],
      openFile: null,
    });
  }

  openFileById(fileId) {
    this.openFile = fileId;
    this._renderView();
    SoundManager.play("beep");
    emitSocket("fileBrowserNavigate", this.terminal.terminalId, {
      currentPath: [...this.currentPath],
      openFile: fileId,
    });
  }

  goBack() {
    if (this.openFile) {
      this.openFile = null;
    } else if (this.currentPath.length > 0) {
      this.currentPath.pop();
    }
    this._renderView();
    SoundManager.play("keystroke");
    emitSocket("fileBrowserNavigate", this.terminal.terminalId, {
      currentPath: [...this.currentPath],
      openFile: this.openFile,
    });
  }

  navigateToBreadcrumb(index) {
    if (index < 0) {
      this.currentPath = [];
    } else {
      this.currentPath = this.currentPath.slice(0, index + 1);
    }
    this.openFile = null;
    this._renderView();
    SoundManager.play("keystroke");
    emitSocket("fileBrowserNavigate", this.terminal.terminalId, {
      currentPath: [...this.currentPath],
      openFile: null,
    });
  }

  receiveNavigate(payload) {
    if (!this.active || !this.element) return;
    this.currentPath = payload.currentPath || [];
    this.openFile = payload.openFile || null;
    this._renderView();
    SoundManager.play("keystroke");
  }

  receiveReveal(payload) {
    if (!this.active || !this.element) return;
    const node = this._findNodeById(this.filesystem, payload.nodeId);
    if (node) {
      node.hidden = payload.hidden;
      this._renderView();
    }
  }

  receiveFilesystemUpdate(payload) {
    this.filesystem = payload.filesystem;
    const folder = this._getNodeAtPath(this.currentPath);
    if (!folder) {
      this.currentPath = [];
      this.openFile = null;
    }
    if (this.openFile && !this._findNodeById(this.filesystem, this.openFile)) {
      this.openFile = null;
    }
    if (!this.active || !this.element) return;
    this._renderView();
  }

  receiveNavigationLock(payload) {
    this.navigationLocked = payload.locked;
    if (!this.active || !this.element) return;
    this._renderView();
  }
}
