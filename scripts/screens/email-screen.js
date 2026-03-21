import { BaseScreen } from "./base-screen.js";
import { SoundManager } from "../effects/sounds.js";

export class EmailScreen extends BaseScreen {
  static get screenId() {
    return "email";
  }
  static get screenName() {
    return "Email";
  }
  get hasInput() {
    return false;
  }
  get template() {
    return "modules/interactive-terminal/templates/screens/email.hbs";
  }

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.emails = (config.emails || []).map((e) => ({ ...e }));
    this.openEmailId = null;
    this.accountName = config.accountName || "user@corp.local";
  }

  getData() {
    const unreadCount = this.emails.filter((e) => !e.read).length;
    return {
      ...super.getData(),
      accountName: this.accountName,
      unreadCount,
      totalCount: this.emails.length,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this._renderView();
    this._activateListeners(container);
  }

  _activateListeners(container) {
    container.addEventListener("click", (e) => {
      const row = e.target.closest(".iterm-email-row");
      if (row) {
        this._openEmail(row.dataset.emailId);
        return;
      }
      if (e.target.closest(".iterm-email-back-btn")) {
        this._closeEmail();
        return;
      }
      const starBtn = e.target.closest(".iterm-email-star");
      if (starBtn) {
        e.stopPropagation();
        this._toggleStar(starBtn.dataset.emailId);
      }
    });
  }

  receiveEmail(email) {
    this.emails.unshift({ ...email });
    if (this.active && this.element) {
      if (!this.openEmailId) {
        this._renderView();
      } else {
        this._updateUnreadBadge();
      }
      SoundManager.play("beep");
    }
  }

  markRead(emailId, read = true) {
    const email = this.emails.find((e) => e.id === emailId);
    if (email) email.read = read;
    if (this.active && this.element) this._renderView();
  }

  deleteEmail(emailId) {
    this.emails = this.emails.filter((e) => e.id !== emailId);
    if (this.openEmailId === emailId) this.openEmailId = null;
    if (this.active && this.element) this._renderView();
  }

  clearAll() {
    this.emails = [];
    this.openEmailId = null;
    if (this.active && this.element) this._renderView();
  }

  _openEmail(emailId) {
    const email = this.emails.find((e) => e.id === emailId);
    if (!email) return;
    email.read = true;
    this.openEmailId = emailId;
    this._renderView();
    SoundManager.play("keystroke");
  }

  _closeEmail() {
    this.openEmailId = null;
    this._renderView();
    SoundManager.play("keystroke");
  }

  _toggleStar(emailId) {
    const email = this.emails.find((e) => e.id === emailId);
    if (!email) return;
    email.starred = !email.starred;
    this._renderView();
  }

  _updateUnreadBadge() {
    const badge = this.element?.querySelector(".iterm-email-unread-count");
    if (badge) {
      const count = this.emails.filter((e) => !e.read).length;
      badge.textContent = count;
      badge.style.display = count > 0 ? "inline" : "none";
    }
  }

  _renderView() {
    if (!this.element) return;
    const content = this.element.querySelector(".iterm-email-content");
    if (!content) return;

    if (this.openEmailId) {
      this._renderDetail(content);
    } else {
      this._renderInbox(content);
    }
    this._updateUnreadBadge();
  }

  _renderInbox(content) {
    content.innerHTML = "";

    if (this.emails.length === 0) {
      const empty = document.createElement("div");
      empty.classList.add("iterm-email-empty", "term-dim");
      empty.textContent = game.i18n.localize("ITERM.Email.Empty");
      content.appendChild(empty);
      return;
    }

    const sorted = [...this.emails].sort((a, b) => (b.date || 0) - (a.date || 0));

    for (const email of sorted) {
      const row = document.createElement("div");
      row.classList.add("iterm-email-row");
      if (!email.read) row.classList.add("iterm-email-unread");
      row.dataset.emailId = email.id;

      const indicator = document.createElement("span");
      indicator.classList.add("iterm-email-indicator");
      indicator.textContent = email.read ? " " : "●";
      row.appendChild(indicator);

      const star = document.createElement("span");
      star.classList.add("iterm-email-star");
      star.dataset.emailId = email.id;
      star.innerHTML = `<i class="fas fa-star"></i>`;
      if (email.starred) star.classList.add("iterm-email-starred");
      row.appendChild(star);

      const from = document.createElement("span");
      from.classList.add("iterm-email-from");
      from.textContent = email.from || "Unknown";
      row.appendChild(from);

      const subject = document.createElement("span");
      subject.classList.add("iterm-email-subject");
      subject.textContent = email.subject || "(no subject)";
      row.appendChild(subject);

      const date = document.createElement("span");
      date.classList.add("iterm-email-date");
      date.textContent = this._formatDate(email.date);
      row.appendChild(date);

      content.appendChild(row);
    }
  }

  _renderDetail(content) {
    const email = this.emails.find((e) => e.id === this.openEmailId);
    if (!email) {
      this.openEmailId = null;
      this._renderInbox(content);
      return;
    }

    content.innerHTML = "";

    const header = document.createElement("div");
    header.classList.add("iterm-email-detail-header");

    const backBtn = document.createElement("button");
    backBtn.classList.add("iterm-email-back-btn");
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Inbox';
    header.appendChild(backBtn);
    content.appendChild(header);

    const meta = document.createElement("div");
    meta.classList.add("iterm-email-meta");

    const fields = [
      { label: "From", value: email.from || "Unknown" },
      { label: "To", value: email.to || this.accountName },
      { label: "Date", value: this._formatDateFull(email.date) },
      { label: "Subject", value: email.subject || "(no subject)" },
    ];

    for (const field of fields) {
      const row = document.createElement("div");
      row.classList.add("iterm-email-meta-row");

      const label = document.createElement("span");
      label.classList.add("iterm-email-meta-label");
      label.textContent = `${field.label}:`;
      row.appendChild(label);

      const value = document.createElement("span");
      value.classList.add("iterm-email-meta-value");
      value.textContent = field.value;
      row.appendChild(value);

      meta.appendChild(row);
    }
    content.appendChild(meta);

    const separator = document.createElement("div");
    separator.classList.add("iterm-email-separator");
    content.appendChild(separator);

    const body = document.createElement("div");
    body.classList.add("iterm-email-body");
    body.textContent = email.body || "";
    content.appendChild(body);

    if (email.attachments?.length) {
      const attSection = document.createElement("div");
      attSection.classList.add("iterm-email-attachments");

      const attLabel = document.createElement("div");
      attLabel.classList.add("iterm-email-att-label", "term-dim");
      attLabel.textContent = `── Attachments (${email.attachments.length}) ──`;
      attSection.appendChild(attLabel);

      for (const att of email.attachments) {
        const attRow = document.createElement("div");
        attRow.classList.add("iterm-email-attachment");
        attRow.innerHTML = `<i class="fas fa-paperclip"></i>`;

        const attName = document.createElement("span");
        attName.textContent = att.name || "file";
        attRow.appendChild(attName);

        if (att.size) {
          const attSize = document.createElement("span");
          attSize.classList.add("term-dim");
          attSize.textContent = ` (${att.size})`;
          attRow.appendChild(attSize);
        }
        attSection.appendChild(attRow);
      }
      content.appendChild(attSection);
    }
  }

  _formatDate(timestamp) {
    if (!timestamp) return "";
    const d = new Date(timestamp);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    if (d.toDateString() === now.toDateString()) {
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }

  _formatDateFull(timestamp) {
    if (!timestamp) return "Unknown";
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, "0");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${days[d.getDay()]}, ${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}
