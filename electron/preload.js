// レンダラに安全な API を公開する preload スクリプト
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('wpgen', {
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
  },
  site: {
    selectFolder: invoke('site:selectFolder'),
    open: invoke('site:open'),
    close: invoke('site:close'),
  },
  articles: {
    list: invoke('articles:list'),
    read: invoke('articles:read'),
    save: invoke('articles:save'),
    create: invoke('articles:create'),
    delete: invoke('articles:delete'),
  },
  git: {
    info: invoke('git:info'),
    pull: invoke('git:pull'),
    sync: invoke('git:sync'),
    clone: invoke('git:clone'),
  },
  app: {
    info: invoke('app:info'),
  },
  deploy: {
    state: invoke('deploy:state'),
    run: invoke('deploy:run'),
    clearPassword: invoke('deploy:clearPassword'),
    onProgress: (cb) => {
      const listener = (_e, info) => cb(info);
      ipcRenderer.on('deploy-progress', listener);
      return () => ipcRenderer.removeListener('deploy-progress', listener);
    },
  },
  preview: {
    start: invoke('preview:start'),
    stop: invoke('preview:stop'),
    status: invoke('preview:status'),
    onStopped: (cb) => {
      const listener = (_e, info) => cb(info);
      ipcRenderer.on('preview-stopped', listener);
      return () => ipcRenderer.removeListener('preview-stopped', listener);
    },
  },
});
