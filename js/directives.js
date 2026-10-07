/* ==========================================================================
   F.R.I.D.A.Y. // DIRECTIVES MANAGER — persistent task list
   The IndexedDB memory core has been stripped out. Directives now persist in
   localStorage so the task log still survives page reloads with no backend.
   ========================================================================== */

import { soundFX } from '../sound-fx.js';

const STORAGE_KEY = 'friday.directives';

/* Minimal local persistence layer (replaces the removed memory-store). */
const directiveStore = {
  saveDirectives(directives) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(directives));
    } catch (e) {
      console.warn('Directive save failed:', e);
    }
  },
  loadDirectives() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('Directive load failed:', e);
      return [];
    }
  }
};

export class DirectiveManager {
  constructor(app) {
    this.app = app;
  }

  async loadPersistentData() {
    const saved = directiveStore.loadDirectives();
    if (saved && saved.length > 0) {
      this.app.directives = saved;
      console.log(`🧠 Loaded ${saved.length} persistent directives from local storage`);
    }
    this.renderDirectives();
  }

  addDirectiveFromInput() {
    const text = this.app.directiveInput.value.trim();
    if (!text) return;
    this.app.directiveInput.value = '';
    this.addDirective(text);
    soundFX.playSuccess();
  }

  addDirective(text) {
    const newDir = { id: Date.now(), text, completed: false };
    this.app.directives.unshift(newDir);
    this.renderDirectives();
    directiveStore.saveDirectives(this.app.directives);
  }

  deleteDirective(id) {
    this.app.directives = this.app.directives.filter(d => d.id !== id);
    soundFX.playClick();
    this.renderDirectives();
    directiveStore.saveDirectives(this.app.directives);
  }

  toggleDirective(id) {
    const dir = this.app.directives.find(d => d.id === id);
    if (dir) {
      dir.completed = !dir.completed;
      soundFX.playClick();
      this.renderDirectives();
      directiveStore.saveDirectives(this.app.directives);
    }
  }

  renderDirectives() {
    this.app.directiveList.innerHTML = '';
    const activeCount = this.app.directives.filter(d => !d.completed).length;
    this.app.directiveCount.textContent = `${activeCount} ACTIVE`;

    if (this.app.directives.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'directive-item empty';
      empty.textContent = 'No directives logged.';
      this.app.directiveList.appendChild(empty);
      return;
    }

    this.app.directives.forEach(d => {
      const li = document.createElement('li');
      li.className = `directive-item ${d.completed ? 'completed' : ''}`;

      const span = document.createElement('span');
      span.textContent = d.text;
      span.style.cursor = 'pointer';
      span.addEventListener('click', () => this.toggleDirective(d.id));

      const delBtn = document.createElement('button');
      delBtn.className = 'directive-del';
      delBtn.innerHTML = '&times;';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteDirective(d.id);
      });

      li.appendChild(span);
      li.appendChild(delBtn);
      this.app.directiveList.appendChild(li);
    });
  }
}