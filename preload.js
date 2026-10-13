const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (fn) => ipcRenderer.on(ch, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('buddy', {
  onInit: on('buddy:init'),
  onState: on('buddy:state'),
  onLook: on('buddy:look'),
  onRemind: on('buddy:remind'),
  onCommand: on('buddy:command'),
  ignoreMouse: (v) => ipcRenderer.send('buddy:ignore', v),
  setBusy: (v) => ipcRenderer.send('buddy:busy', v),
  drag: (dx) => ipcRenderer.send('buddy:drag', dx),
  menu: () => ipcRenderer.send('buddy:menu'),
  focus: () => ipcRenderer.send('buddy:focus'),
  hush: () => ipcRenderer.send('buddy:hush'),
  snooze: (text) => ipcRenderer.send('buddy:snooze', text),
  askMic: () => ipcRenderer.invoke('buddy:mic'),
  transcribe: (wav) => ipcRenderer.invoke('buddy:transcribe', wav),
  ask: (text) => ipcRenderer.invoke('buddy:ask', text),
});
