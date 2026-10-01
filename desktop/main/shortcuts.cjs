const {globalShortcut} = require('electron')

exports.shortcuts = (store, show) => {
  let active = {}
  function apply(next) {
    if (!next || Object.keys(next).length !== 2 || !['running','todo'].every(name => typeof next[name] === 'string' && next[name].length > 0)) throw new Error('请设置运行和待办两个快捷键')
    if (next.running.toLowerCase() === next.todo.toLowerCase()) throw new Error('两个界面不能使用相同快捷键')
    const previous = {...active}, installed = []
    Object.values(active).forEach(key => globalShortcut.unregister(key))
    try {
      for (const [mode, key] of Object.entries(next)) {
        if (!globalShortcut.register(key, () => show(mode))) throw new Error(`快捷键无法注册，可能已被占用：${key}`)
        installed.push(key)
      }
      active = {...next}
    } catch (error) {
      installed.forEach(key => globalShortcut.unregister(key))
      for (const [mode,key] of Object.entries(previous)) globalShortcut.register(key, () => show(mode))
      active = previous; throw error
    }
  }
  return {
    start: () => apply(store.read().shortcuts),
    save: next => {const previous = {...active}; apply(next); try {store.save(next)} catch (error) {apply(previous); throw error}},
    close: () => Object.values(active).forEach(key => globalShortcut.unregister(key)),
  }
}
