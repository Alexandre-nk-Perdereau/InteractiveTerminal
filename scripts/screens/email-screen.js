import { BaseScreen } from "./base-screen.js";
import { SoundManager } from "../effects/sounds.js";
import { emitRequestAction } from "../module.js";

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
    this.openThreadId = config.openThreadId || null;
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
        this._openThread(row.dataset.threadId);
        return;
      }
      if (e.target.closest(".iterm-email-back-btn")) {
        this._closeThread();
        return;
      }
      const starBtn = e.target.closest(".iterm-email-star");
      if (starBtn) {
        e.stopPropagation();
        this._toggleStar(starBtn.dataset.emailId);
      }
    });
  }

  _getThreadId(email) {
    return email.threadId || email.id;
  }

  _getThreads() {
    const threadMap = new Map();
    for (const email of this.emails) {
      const tid = this._getThreadId(email);
      if (!threadMap.has(tid)) threadMap.set(tid, []);
      threadMap.get(tid).push(email);
    }
    for (const msgs of threadMap.values()) {
      msgs.sort((a, b) => (a.date || 0) - (b.date || 0));
    }
    return threadMap;
  }

  _getThreadSummaries() {
    const threads = this._getThreads();
    const summaries = [];
    for (const [threadId, messages] of threads) {
      const latest = messages[messages.length - 1];
      const first = messages[0];
      const unread = messages.some((m) => !m.read);
      const starred = messages.some((m) => m.starred);
      const subject = first.subject || "(no subject)";
      summaries.push({
        threadId,
        subject,
        from: latest.from || "Unknown",
        date: latest.date,
        count: messages.length,
        unread,
        starred,
        latestId: latest.id,
      });
    }
    summaries.sort((a, b) => (b.date || 0) - (a.date || 0));
    return summaries;
  }

  applyStateSync(screenConfig, syncMeta) {
    const prevCount = this.emails.length;
    if (screenConfig.emails) this.emails = screenConfig.emails.map((e) => ({ ...e }));
    if (screenConfig.openThreadId !== undefined) this.openThreadId = screenConfig.openThreadId;
    if (this.active && this.element) {
      this._renderView();
      if (this.emails.length > prevCount) SoundManager.play("beep");
    }
  }

  _openThread(threadId) {
    if (!threadId) return;
    for (const email of this.emails) {
      if (this._getThreadId(email) === threadId) email.read = true;
    }
    this.openThreadId = threadId;
    this._renderView();
    SoundManager.play("keystroke");
    emitRequestAction(this.terminal.terminalId, "emailNavigate", {
      openThreadId: threadId,
      emails: this.emails,
    });
  }

  _closeThread() {
    this.openThreadId = null;
    this._renderView();
    SoundManager.play("keystroke");
    emitRequestAction(this.terminal.terminalId, "emailNavigate", {
      openThreadId: null,
      emails: this.emails,
    });
  }

  _toggleStar(emailId) {
    const email = this.emails.find((e) => e.id === emailId);
    if (!email) return;
    email.starred = !email.starred;
    this._renderView();
    emitRequestAction(this.terminal.terminalId, "emailNavigate", {
      openThreadId: this.openThreadId,
      emails: this.emails,
    });
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

    if (this.openThreadId) {
      this._renderThread(content);
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

    const summaries = this._getThreadSummaries();

    for (const thread of summaries) {
      const row = document.createElement("div");
      row.classList.add("iterm-email-row");
      if (thread.unread) row.classList.add("iterm-email-unread");
      row.dataset.threadId = thread.threadId;

      const indicator = document.createElement("span");
      indicator.classList.add("iterm-email-indicator");
      indicator.textContent = thread.unread ? "●" : " ";
      row.appendChild(indicator);

      const star = document.createElement("span");
      star.classList.add("iterm-email-star");
      star.dataset.emailId = thread.latestId;
      star.innerHTML = `<i class="fas fa-star"></i>`;
      if (thread.starred) star.classList.add("iterm-email-starred");
      row.appendChild(star);

      const from = document.createElement("span");
      from.classList.add("iterm-email-from");
      from.textContent = thread.from;
      row.appendChild(from);

      const subject = document.createElement("span");
      subject.classList.add("iterm-email-subject");
      subject.textContent = thread.subject;
      row.appendChild(subject);

      if (thread.count > 1) {
        const count = document.createElement("span");
        count.classList.add("iterm-email-thread-count");
        count.textContent = `(${thread.count})`;
        row.appendChild(count);
      }

      const date = document.createElement("span");
      date.classList.add("iterm-email-date");
      date.textContent = this._formatDate(thread.date);
      row.appendChild(date);

      content.appendChild(row);
    }
  }

  _renderThread(content) {
    const threads = this._getThreads();
    const messages = threads.get(this.openThreadId);
    if (!messages || messages.length === 0) {
      this.openThreadId = null;
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

    const threadSubject = document.createElement("span");
    threadSubject.classList.add("iterm-email-thread-subject", "term-bold");
    threadSubject.textContent = messages[0].subject || "(no subject)";
    header.appendChild(threadSubject);

    const threadCount = document.createElement("span");
    threadCount.classList.add("iterm-email-thread-count", "term-dim");
    threadCount.textContent = messages.length > 1 ? ` (${messages.length} messages)` : "";
    header.appendChild(threadCount);

    content.appendChild(header);

    const reversed = [...messages].reverse();
    for (let i = 0; i < reversed.length; i++) {
      this._renderEmailInThread(content, reversed[i], i === 0);
    }
  }

  _renderEmailInThread(container, email, expanded) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("iterm-email-thread-msg");
    if (!expanded) wrapper.classList.add("iterm-email-thread-collapsed");

    const msgHeader = document.createElement("div");
    msgHeader.classList.add("iterm-email-thread-msg-header");
    msgHeader.addEventListener("click", () => {
      wrapper.classList.toggle("iterm-email-thread-collapsed");
    });

    const fromEl = document.createElement("span");
    fromEl.classList.add("iterm-email-from");
    fromEl.textContent = email.from || "Unknown";
    msgHeader.appendChild(fromEl);

    const dateEl = document.createElement("span");
    dateEl.classList.add("iterm-email-date", "term-dim");
    dateEl.textContent = this._formatDateFull(email.date);
    msgHeader.appendChild(dateEl);

    wrapper.appendChild(msgHeader);

    const bodySection = document.createElement("div");
    bodySection.classList.add("iterm-email-thread-msg-body");

    const toLine = document.createElement("div");
    toLine.classList.add("iterm-email-meta-row", "term-dim");
    toLine.textContent = `To: ${email.to || this.accountName}`;
    bodySection.appendChild(toLine);

    const separator = document.createElement("div");
    separator.classList.add("iterm-email-separator");
    bodySection.appendChild(separator);

    const body = document.createElement("div");
    body.classList.add("iterm-email-body");
    body.textContent = email.body || "";
    bodySection.appendChild(body);

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
      bodySection.appendChild(attSection);
    }

    wrapper.appendChild(bodySection);
    container.appendChild(wrapper);
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
