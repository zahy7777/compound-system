const fs = require('node:fs')
const path = require('node:path')

exports.settings = (directory, environment) => {
  const file = path.join(directory, 'shortcuts.json'), prefix = environment === 'dev' ? 'Control+' : ''
  let shortcuts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {running: `${prefix}Shift+Space`, todo: `${prefix}Shift+Alt+Q`}
  return {
    read: () => ({environment, shortcuts: {...shortcuts}}),
    save: next => {fs.mkdirSync(directory, {recursive: true}); fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8'); shortcuts = {...next}},
  }
}
