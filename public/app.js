const MAX_FALLBACK_BYTES = 25 * 1024 * 1024;
const STORE = {
  name: "classshare.name",
  device: "classshare.device",
  theme: "classshare.theme",
  admin: "classshare.adminPasscode"
};

const state = {
  posts: [],
  categories: [],
  stats: { postCount: 0, fileCount: 0, storageUsed: 0, maxFileBytes: MAX_FALLBACK_BYTES },
  filter: "All",
  view: "feed",
  type: "file",
  editingId: null,
  adminPasscode: localStorage.getItem(STORE.admin) || "",
  loading: false
};

const els = {
  html: document.documentElement,
  appName: document.querySelector("#appName"),
  themeToggle: document.querySelector("#themeToggle"),
  refreshButton: document.querySelector("#refreshButton"),
  adminButton: document.querySelector("#adminButton"),
  changeNameButton: document.querySelector("#changeNameButton"),
  profileInitial: document.querySelector("#profileInitial"),
  profileName: document.querySelector("#profileName"),
  profileMode: document.querySelector("#profileMode"),
  searchInput: document.querySelector("#searchInput"),
  categoryList: document.querySelector("#categoryList"),
  postCount: document.querySelector("#postCount"),
  fileCount: document.querySelector("#fileCount"),
  storageUsed: document.querySelector("#storageUsed"),
  postForm: document.querySelector("#postForm"),
  composerTitle: document.querySelector("#composerTitle"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  titleInput: document.querySelector("#titleInput"),
  categorySelect: document.querySelector("#categorySelect"),
  textField: document.querySelector("#textField"),
  bodyInput: document.querySelector("#bodyInput"),
  linkField: document.querySelector("#linkField"),
  urlInput: document.querySelector("#urlInput"),
  fileField: document.querySelector("#fileField"),
  fileInput: document.querySelector("#fileInput"),
  uploadTitle: document.querySelector("#uploadTitle"),
  uploadHint: document.querySelector("#uploadHint"),
  submitButton: document.querySelector("#submitButton"),
  formStatus: document.querySelector("#formStatus"),
  feedTitle: document.querySelector("#feedTitle"),
  sortSelect: document.querySelector("#sortSelect"),
  postList: document.querySelector("#postList"),
  emptyState: document.querySelector("#emptyState"),
  postTemplate: document.querySelector("#postTemplate"),
  nameDialog: document.querySelector("#nameDialog"),
  nameForm: document.querySelector("#nameForm"),
  nameInput: document.querySelector("#nameInput"),
  adminDialog: document.querySelector("#adminDialog"),
  adminForm: document.querySelector("#adminForm"),
  adminPassInput: document.querySelector("#adminPassInput"),
  adminTools: document.querySelector("#adminTools"),
  adminStatus: document.querySelector("#adminStatus"),
  unlockAdminButton: document.querySelector("#unlockAdminButton"),
  closeAdminButton: document.querySelector("#closeAdminButton"),
  newCategoryInput: document.querySelector("#newCategoryInput"),
  addCategoryButton: document.querySelector("#addCategoryButton"),
  clearDemoButton: document.querySelector("#clearDemoButton")
};

function deviceId() {
  let id = localStorage.getItem(STORE.device);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(STORE.device, id);
  }
  return id;
}

function userName() {
  return (localStorage.getItem(STORE.name) || "").trim();
}

function setStatus(message, isError = false) {
  els.formStatus.textContent = message || "";
  els.formStatus.style.color = isError ? "var(--red)" : "var(--muted)";
}

function adminStatus(message, isError = false) {
  els.adminStatus.textContent = message || "";
  els.adminStatus.style.color = isError ? "var(--red)" : "var(--muted)";
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function formatDate(ms) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(ms));
}

function escapeText(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function isOwn(item) {
  return item.deviceId === deviceId();
}

function isAdmin() {
  return Boolean(state.adminPasscode);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch {
      detail = response.statusText || detail;
    }
    throw new Error(detail);
  }
  return response.json();
}

async function loadState() {
  const data = await api("/api/state");
  state.posts = data.posts || [];
  state.categories = data.categories || [];
  state.stats = data.stats || state.stats;
  render();
}

function syncProfile() {
  const name = userName() || "Classmate";
  els.profileName.textContent = name;
  els.profileInitial.textContent = name.slice(0, 2).toUpperCase();
  els.profileMode.textContent = isAdmin() ? "Admin mode" : "Member mode";
}

function syncTheme() {
  const theme = localStorage.getItem(STORE.theme) || "light";
  els.html.dataset.theme = theme;
  els.themeToggle.textContent = theme === "dark" ? "DK" : "LT";
}

function renderCategories() {
  const counts = new Map();
  for (const post of state.posts) {
    counts.set(post.category, (counts.get(post.category) || 0) + 1);
  }
  const allCount = state.posts.length;
  const categories = ["All", ...state.categories];
  els.categoryList.innerHTML = "";

  for (const category of categories) {
    const row = document.createElement("div");
    row.className = "category-row";
    row.style.display = "grid";
    row.style.gridTemplateColumns = isAdmin() && !isDefaultCategory(category) && category !== "All" ? "1fr auto" : "1fr";
    row.style.gap = "6px";

    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-pill${state.filter === category ? " active" : ""}`;
    button.dataset.category = category;
    button.innerHTML = `<span>${escapeText(category)}</span><span>${category === "All" ? allCount : (counts.get(category) || 0)}</span>`;
    row.append(button);

    if (isAdmin() && !isDefaultCategory(category) && category !== "All") {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "small-button danger";
      del.textContent = "Del";
      del.dataset.deleteCategory = category;
      row.append(del);
    }
    els.categoryList.append(row);
  }

  els.categorySelect.innerHTML = state.categories
    .map((category) => `<option value="${escapeText(category)}">${escapeText(category)}</option>`)
    .join("");
}

function isDefaultCategory(category) {
  return ["Notes", "Assignments", "Links", "Question Papers", "Projects", "Announcements", "Other"].includes(category);
}

function filteredPosts() {
  const search = els.searchInput.value.trim().toLowerCase();
  let posts = state.posts.filter((post) => state.filter === "All" || post.category === state.filter);
  if (search) {
    posts = posts.filter((post) => {
      const bag = [
        post.title,
        post.body,
        post.url,
        post.category,
        post.author,
        post.file?.name,
        ...(post.comments || []).map((comment) => `${comment.author} ${comment.body}`)
      ].join(" ").toLowerCase();
      return bag.includes(search);
    });
  }
  const sort = els.sortSelect.value;
  posts = [...posts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "old") return a.createdAt - b.createdAt;
    if (sort === "title") return a.title.localeCompare(b.title);
    return b.createdAt - a.createdAt;
  });
  return posts;
}

function renderPosts() {
  const posts = filteredPosts();
  els.postList.innerHTML = "";
  els.emptyState.hidden = posts.length > 0;

  if (state.view === "categories") {
    const grouped = new Map();
    for (const post of posts) {
      grouped.set(post.category, [...(grouped.get(post.category) || []), post]);
    }
    for (const category of state.categories) {
      const group = grouped.get(category);
      if (!group?.length) continue;
      const heading = document.createElement("section");
      heading.className = "feed-head";
      heading.innerHTML = `<div><p class="eyebrow">${escapeText(category)}</p><h2>${group.length} item${group.length === 1 ? "" : "s"}</h2></div>`;
      els.postList.append(heading);
      for (const post of group) els.postList.append(postElement(post));
    }
  } else {
    for (const post of posts) els.postList.append(postElement(post));
  }
}

function postElement(post) {
  const node = els.postTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.kind = post.type;
  node.classList.toggle("pinned", post.pinned);
  node.querySelector(".post-type").textContent = post.type === "file" ? "FL" : post.type === "link" ? "LK" : "TX";
  node.querySelector("h3").textContent = post.title;
  node.querySelector(".pin-label").hidden = !post.pinned;
  node.querySelector(".post-meta").innerHTML = [
    `By ${escapeText(post.author)}`,
    escapeText(post.category),
    formatDate(post.createdAt),
    post.updatedAt !== post.createdAt ? "Edited" : ""
  ].filter(Boolean).map((item) => `<span>${item}</span>`).join("");

  const body = node.querySelector(".post-body");
  body.textContent = post.body || "";
  body.hidden = !post.body;

  const menu = node.querySelector(".post-menu");
  const canEdit = isOwn(post) || isAdmin();
  if (isAdmin()) {
    menu.append(actionButton(post.pinned ? "Unpin" : "Pin", () => pinPost(post, !post.pinned)));
  }
  if (canEdit) {
    menu.append(actionButton("Edit", () => editPost(post)));
    menu.append(actionButton("Delete", () => deletePost(post), "danger"));
  }

  if (post.file) {
    const file = node.querySelector(".post-file");
    file.hidden = false;
    file.innerHTML = `
      <div class="file-name">
        <strong>${escapeText(post.file.name)}</strong>
        <small>${escapeText(post.file.type || "file")} - ${formatBytes(post.file.size)}. Only download files you trust.</small>
      </div>
      <a class="download-link" href="${post.file.downloadUrl}" download>Download</a>
    `;
  }

  if (post.url) {
    const link = node.querySelector(".post-link");
    link.hidden = false;
    link.innerHTML = `
      <div class="link-name">
        <strong>${escapeText(post.url)}</strong>
        <small>Opens in a new tab</small>
      </div>
      <a class="open-link" href="${escapeText(post.url)}" target="_blank" rel="noopener noreferrer">Open</a>
    `;
  }

  renderComments(node.querySelector(".comments"), post);
  return node;
}

function actionButton(label, handler, variant = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `small-button ${variant}`.trim();
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function renderComments(container, post) {
  container.innerHTML = "";
  const title = document.createElement("strong");
  title.textContent = `${post.comments.length} comment${post.comments.length === 1 ? "" : "s"}`;
  container.append(title);

  for (const comment of post.comments) {
    const item = document.createElement("div");
    item.className = "comment";
    const canEdit = isOwn(comment) || isAdmin();
    item.innerHTML = `
      <div class="comment-head">
        <strong>${escapeText(comment.author)}</strong>
        <small>${formatDate(comment.createdAt)}${comment.updatedAt !== comment.createdAt ? " - edited" : ""}</small>
      </div>
      <p>${escapeText(comment.body)}</p>
    `;
    if (canEdit) {
      const actions = document.createElement("div");
      actions.className = "comment-actions";
      actions.append(actionButton("Edit", () => editComment(comment)));
      actions.append(actionButton("Delete", () => deleteComment(comment), "danger"));
      item.append(actions);
    }
    container.append(item);
  }

  const form = document.createElement("form");
  form.className = "comment-form";
  form.innerHTML = `
    <input type="text" name="body" maxlength="4000" placeholder="Write a comment" />
    <button class="small-button" type="submit">Send</button>
  `;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.elements.body;
    const body = input.value.trim();
    if (!body) return;
    try {
      await api(`/api/posts/${post.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, author: userName(), device_id: deviceId() })
      });
      input.value = "";
      await loadState();
    } catch (error) {
      alert(error.message);
    }
  });
  container.append(form);
}

function renderStats() {
  els.postCount.textContent = state.stats.postCount ?? state.posts.length;
  els.fileCount.textContent = state.stats.fileCount ?? state.posts.filter((post) => post.file).length;
  els.storageUsed.textContent = formatBytes(state.stats.storageUsed || 0);
}

function render() {
  syncProfile();
  renderCategories();
  renderStats();
  renderPosts();
  els.adminTools.hidden = !isAdmin();
}

function updateType(type) {
  state.type = type;
  document.querySelectorAll(".type-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.type === type);
  });
  const bodyLabel = els.textField.querySelector("span");
  els.linkField.hidden = type !== "link";
  els.fileField.hidden = type !== "file";
  els.bodyInput.required = type === "text";
  els.urlInput.required = type === "link";
  els.fileInput.required = type === "file" && !state.editingId;
  bodyLabel.textContent = type === "text" ? "Text" : "Description";
  els.bodyInput.placeholder = type === "text" ? "Write the note here" : "Optional description";
}

function resetComposer() {
  state.editingId = null;
  els.composerTitle.textContent = "New post";
  els.cancelEditButton.hidden = true;
  els.submitButton.textContent = "Post";
  els.postForm.reset();
  updateType("file");
  setUploadLabel();
  setStatus("");
}

function editPost(post) {
  state.editingId = post.id;
  els.composerTitle.textContent = "Edit post";
  els.cancelEditButton.hidden = false;
  els.submitButton.textContent = "Save";
  updateType(post.type);
  els.titleInput.value = post.title;
  els.categorySelect.value = post.category;
  els.bodyInput.value = post.body || "";
  els.urlInput.value = post.url || "";
  els.fileInput.required = false;
  els.fileField.hidden = true;
  setStatus("Editing existing post. File attachments stay the same.");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setUploadLabel(file = null) {
  if (file) {
    els.uploadTitle.textContent = file.name;
    els.uploadHint.textContent = `${formatBytes(file.size)} selected`;
  } else {
    els.uploadTitle.textContent = "Choose a file or drag it here";
    els.uploadHint.textContent = "Any file type, up to 25 MB.";
  }
}

async function submitPost(event) {
  event.preventDefault();
  if (!userName()) {
    openNameDialog();
    return;
  }
  setStatus("Saving...");
  els.submitButton.disabled = true;
  try {
    const category = els.categorySelect.value || "Other";
    if (state.editingId) {
      await api(`/api/posts/${state.editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: els.titleInput.value,
          body: els.bodyInput.value,
          url: els.urlInput.value,
          category,
          author: userName(),
          device_id: deviceId(),
          admin_passcode: state.adminPasscode
        })
      });
      resetComposer();
      await loadState();
      setStatus("Post updated.");
      return;
    }

    const form = new FormData();
    form.append("type", state.type);
    form.append("title", els.titleInput.value);
    form.append("body", els.bodyInput.value);
    form.append("url", els.urlInput.value);
    form.append("category", category);
    form.append("author", userName());
    form.append("device_id", deviceId());

    if (state.type === "file") {
      const file = els.fileInput.files[0];
      if (!file) throw new Error("Choose a file first");
      const limit = state.stats.maxFileBytes || MAX_FALLBACK_BYTES;
      if (file.size > limit) throw new Error(`File is larger than ${formatBytes(limit)}`);
      form.append("file", file);
    }

    await api("/api/posts", { method: "POST", body: form });
    resetComposer();
    await loadState();
    setStatus("Posted.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    els.submitButton.disabled = false;
  }
}

async function deletePost(post) {
  if (!confirm(`Delete "${post.title}"?`)) return;
  try {
    await api(`/api/posts/${post.id}`, {
      method: "DELETE",
      body: JSON.stringify({ device_id: deviceId(), admin_passcode: state.adminPasscode })
    });
    await loadState();
  } catch (error) {
    alert(error.message);
  }
}

async function pinPost(post, pinned) {
  try {
    await api(`/api/posts/${post.id}/pin`, {
      method: "POST",
      body: JSON.stringify({ pinned, admin_passcode: state.adminPasscode })
    });
    await loadState();
  } catch (error) {
    alert(error.message);
  }
}

async function editComment(comment) {
  const body = prompt("Edit comment", comment.body);
  if (body === null) return;
  try {
    await api(`/api/comments/${comment.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        body,
        author: userName(),
        device_id: deviceId(),
        admin_passcode: state.adminPasscode
      })
    });
    await loadState();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteComment(comment) {
  if (!confirm("Delete this comment?")) return;
  try {
    await api(`/api/comments/${comment.id}`, {
      method: "DELETE",
      body: JSON.stringify({ device_id: deviceId(), admin_passcode: state.adminPasscode })
    });
    await loadState();
  } catch (error) {
    alert(error.message);
  }
}

function openNameDialog() {
  els.nameInput.value = userName();
  els.nameDialog.showModal();
  setTimeout(() => els.nameInput.focus(), 30);
}

async function unlockAdmin(event) {
  event.preventDefault();
  const passcode = els.adminPassInput.value.trim();
  try {
    await api("/api/admin/check", { method: "POST", body: JSON.stringify({ passcode }) });
    state.adminPasscode = passcode;
    localStorage.setItem(STORE.admin, passcode);
    adminStatus("Admin mode unlocked.");
    els.adminTools.hidden = false;
    els.profileMode.textContent = "Admin mode";
    renderCategories();
    renderPosts();
  } catch (error) {
    adminStatus(error.message, true);
  }
}

async function addCategory() {
  const name = els.newCategoryInput.value.trim();
  if (!name) return;
  try {
    await api("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name, admin_passcode: state.adminPasscode })
    });
    els.newCategoryInput.value = "";
    await loadState();
    adminStatus("Category added.");
  } catch (error) {
    adminStatus(error.message, true);
  }
}

async function deleteCategory(category) {
  if (!confirm(`Delete category "${category}"? Posts will move to Other.`)) return;
  try {
    await api(`/api/categories/${encodeURIComponent(category)}`, {
      method: "DELETE",
      body: JSON.stringify({ passcode: state.adminPasscode })
    });
    state.filter = "All";
    await loadState();
  } catch (error) {
    alert(error.message);
  }
}

async function clearAllPosts() {
  if (!confirm("Clear every post, comment, and uploaded file?")) return;
  try {
    await api("/api/maintenance/clear-demo", {
      method: "POST",
      body: JSON.stringify({ passcode: state.adminPasscode })
    });
    await loadState();
    adminStatus("All posts cleared.");
  } catch (error) {
    adminStatus(error.message, true);
  }
}

function bindEvents() {
  els.themeToggle.addEventListener("click", () => {
    const next = els.html.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(STORE.theme, next);
    syncTheme();
  });

  els.refreshButton.addEventListener("click", () => loadState().catch((error) => setStatus(error.message, true)));
  els.changeNameButton.addEventListener("click", openNameDialog);
  els.postForm.addEventListener("submit", submitPost);
  els.cancelEditButton.addEventListener("click", resetComposer);
  els.searchInput.addEventListener("input", renderPosts);
  els.sortSelect.addEventListener("change", renderPosts);

  document.querySelectorAll(".type-button").forEach((button) => {
    button.addEventListener("click", () => updateType(button.dataset.type));
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      document.querySelectorAll(".tab-button").forEach((tab) => tab.classList.toggle("active", tab === button));
      els.feedTitle.textContent = state.view === "feed" ? "Latest shares" : "Browse by category";
      renderPosts();
    });
  });

  els.categoryList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-category]");
    if (deleteButton) {
      deleteCategory(deleteButton.dataset.deleteCategory);
      return;
    }
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.filter = button.dataset.category;
    renderCategories();
    renderPosts();
  });

  els.fileInput.addEventListener("change", () => setUploadLabel(els.fileInput.files[0]));
  ["dragenter", "dragover"].forEach((eventName) => {
    els.fileField.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.fileField.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    els.fileField.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.fileField.classList.remove("dragover");
    });
  });
  els.fileField.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    els.fileInput.files = transfer.files;
    setUploadLabel(file);
  });

  els.nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = els.nameInput.value.trim();
    if (!name) return;
    localStorage.setItem(STORE.name, name);
    syncProfile();
    els.nameDialog.close();
  });

  els.adminButton.addEventListener("click", () => {
    els.adminPassInput.value = state.adminPasscode;
    adminStatus(isAdmin() ? "Admin mode is active." : "");
    els.adminTools.hidden = !isAdmin();
    els.adminDialog.showModal();
  });
  els.adminForm.addEventListener("submit", unlockAdmin);
  els.closeAdminButton.addEventListener("click", () => els.adminDialog.close());
  els.addCategoryButton.addEventListener("click", addCategory);
  els.clearDemoButton.addEventListener("click", clearAllPosts);
}

async function boot() {
  deviceId();
  syncTheme();
  bindEvents();
  updateType("file");
  syncProfile();
  if (!userName()) openNameDialog();
  try {
    await loadState();
    if (state.adminPasscode) {
      try {
        await api("/api/admin/check", {
          method: "POST",
          body: JSON.stringify({ passcode: state.adminPasscode })
        });
      } catch {
        state.adminPasscode = "";
        localStorage.removeItem(STORE.admin);
        syncProfile();
        render();
      }
    }
  } catch (error) {
    setStatus(`Could not load server data: ${error.message}`, true);
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

boot();
