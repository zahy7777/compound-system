const cache = new Map()
function hash(value) {let result = 2166136261; for (const char of value) result = Math.imul(result ^ char.codePointAt(0),16777619); return result >>> 0}
function hue(value) {
  let result=hash(value)
  result=Math.imul(result^(result>>>16),0x7feb352d)
  result=Math.imul(result^(result>>>15),0x846ca68b)
  return ((result^(result>>>16))>>>0)%360
}

/** 静态 SVG 轮廓：实际像素生成毛边，内侧保留完整阅读区。 */
export function paperMask(width, height, key, tear = 3) {
  const w = Math.max(16,Math.ceil(width / 4) * 4), h = Math.max(12,Math.ceil(height / 2) * 2), variant = hash(key) % 48
  const identity = `${w}:${h}:${variant}:${tear}`
  if (cache.has(identity)) return cache.get(identity)
  let state = variant + 1
  const random = () => {state = Math.imul(state,1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296}
  if (tear === 3) {
    // 纸条的整体形状先撕歪，再叠加细碎缺口；不以内接矩形填平边缘。
    const points = [], edge = Math.min(7,h * .22), side = Math.min(13,w * .15)
    const left = side * (.25 + random() * .6), right = side * (.25 + random() * .6)
    const upper = random() * edge * .65, lower = random() * edge * .65
    for (let x=left;x<w-right;x+=4+random()*7) {
      const slope = upper * x/w, bite = random() < .22 ? edge * .75 : random()*edge*.42
      points.push(`${x.toFixed(2)},${(slope+bite).toFixed(2)}`)
    }
    points.push(`${w-right},${edge*.35}`)
    for (let y=edge*.35;y<h-edge*.35;y+=3+random()*4) points.push(`${(w-right*(y/h)-random()*side*.45).toFixed(2)},${y.toFixed(2)}`)
    points.push(`${w-right*.7},${h-lower}`)
    for (let x=w-right*.7;x>left;x-=4+random()*7) {
      const slope = lower * (1-x/w), bite = random() < .22 ? edge * .8 : random()*edge*.4
      points.push(`${x.toFixed(2)},${(h-slope-bite).toFixed(2)}`)
    }
    points.push(`${left*.3},${h-edge*.35}`)
    for (let y=h-edge*.35;y>edge*.35;y-=3+random()*4) points.push(`${(left*(1-y/h)+random()*side*.5).toFixed(2)},${y.toFixed(2)}`)
    // 只画实色轮廓和碎片；纸张与空洞之间不做透明过渡。
    const scraps=[]
    for(let x=7;x<w-7;x+=9+random()*14){
      const size=3+random()*8, top=random()*8, bottom=h-random()*8
      scraps.push(`<path d="M${x} ${top}l${size} ${random()*5}l${-size*.35} ${size*.7}l${-size} ${-size*.25}z M${x} ${bottom}l${size} ${-random()*5}l${-size*.55} ${-size*.7}l${-size*.7} ${size*.25}z" fill="white" opacity="1"/>`)
    }
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><polygon points="${points.join(' ')}" fill="white"/>${scraps.join('')}</svg>`
    const result=`url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    if(cache.size>=512) cache.delete(cache.keys().next().value)
    cache.set(identity,result);return result
  }
  const points = [], step = 7
  for (let x=0;x<=w;x+=step) points.push(`${x},${(random()*tear).toFixed(2)}`)
  points.push(`${w},1`)
  for (let y=3;y<h;y+=step) points.push(`${(w-random()*tear).toFixed(2)},${y}`)
  points.push(`${w},${h-1}`)
  for (let x=w;x>=0;x-=step) points.push(`${x},${(h-random()*tear).toFixed(2)}`)
  points.push(`0,${h-1}`)
  for (let y=h-3;y>0;y-=step) points.push(`${(random()*tear).toFixed(2)},${y}`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><polygon points="${points.join(' ')}" fill="white"/></svg>`
  const result = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  if (cache.size >= 512) cache.delete(cache.keys().next().value)
  cache.set(identity,result); return result
}

/** 共用装饰底板始终位于全部内容下面；不拥有布局或业务事实。 */
export function createPaper(root) {
  let enabled=false, frame=0
  const watched=new Set(), layers=new Map(), patches=new Map(), hues=new Set()
  const selector='[data-paper],button,.loop-name,.count,dialog,.login-card'
  function layer(host) {
    if(layers.has(host)) return layers.get(host)
    const board=document.createElement('div');board.className='theme-paper-layer';board.setAttribute('aria-hidden','true')
    host.append(board);layers.set(host,board);return board
  }
  function paint(node) {
    const box=node.getBoundingClientRect(), style=getComputedStyle(node)
    const visible=node.isConnected && box.width && box.height && box.bottom>-40 && box.top<innerHeight+40 && style.visibility!=='hidden' && style.opacity!=='0'
    if(node.matches('dialog,.login-card')) {
      if(visible){node.style.setProperty('--surface-mask',paperMask(box.width,box.height,node.getAttribute('aria-label')||node.className,8));node.dataset.surfaceReady=''}
      return
    }
    const host=node.closest('dialog,.login-card')||root
    let patch=patches.get(node)
    if(!visible){if(patch)patch.hidden=true;return}
    const board=layer(host)
    if(!patch){patch=document.createElement('span');patch.className='theme-paper-patch';patches.set(node,patch)}
    if(patch.parentElement!==board)board.append(patch)
    patch.hidden=false
    const origin=host===root?{x:0,y:0}:host.getBoundingClientRect()
    const identity=node.closest('[data-visual-key]')?.dataset.visualKey||node.dataset.paperKey||node.getAttribute('aria-label')||node.textContent
    const mask=paperMask(box.width+44,box.height+28,`${identity}:${node.dataset.paper||'button'}`)
    patch.style.left=`${box.x-origin.x+(host===root?0:host.scrollLeft-host.clientLeft)-22}px`
    patch.style.top=`${box.y-origin.y+(host===root?0:host.scrollTop-host.clientTop)-14}px`
    patch.style.width=`${box.width+44}px`;patch.style.height=`${box.height+28}px`
    patch.style.maskImage=mask
    const fill=style.getPropertyValue('--paper-fill').trim()||style.getPropertyValue('--paper').trim()
    patch.style.background=fill
    patch.style.zIndex=style.getPropertyValue('--paper-order').trim()||(fill.includes('#df1329')||fill.includes('#171317')?'1':'0')
    node.dataset.paperReady=''
  }
  function collect(element) {
    if(element.closest('.theme-paper-layer,.theme-impact'))return
    for(const node of [...(element.matches(selector)?[element]:[]),...element.querySelectorAll(selector)]) {
      if(watched.has(node))continue
      // 嵌套文字由外层阅读块承载；按钮独立填色，统一在底板中重叠。
      if(!node.matches('button,dialog,.login-card')&&node.parentElement.closest('[data-paper]'))continue
      const loop=node.closest('.loop[data-visual-key]')
      if(loop&&!hues.has(loop)){loop.style.setProperty('--paper-hue',hue(loop.dataset.visualKey));hues.add(loop)}
      watched.add(node);resize.observe(node)
    }
  }
  function flush() {
    frame=0
    for(const node of watched){if(!node.isConnected){resize.unobserve(node);watched.delete(node);patches.get(node)?.remove();patches.delete(node)}else paint(node)}
    for(const [host,board] of layers)if(host!==root&&!host.isConnected){board.remove();layers.delete(host)}
    for(const loop of hues)if(!loop.isConnected)hues.delete(loop)
  }
  function schedule(){if(enabled&&!frame)frame=requestAnimationFrame(flush)}
  const resize=new ResizeObserver(schedule)
  const mutations=new MutationObserver(records=>{
    let changed=false
    for(const record of records){
      if(record.target instanceof Element&&record.target.closest('.theme-paper-layer,.theme-impact'))continue
      for(const node of record.addedNodes)if(node instanceof Element&&!node.matches('.theme-paper-layer,.theme-paper-patch,.theme-impact')){collect(node);changed=true}
      if([...record.removedNodes].some(node=>node instanceof Element&&!node.matches('.theme-paper-layer,.theme-paper-patch,.theme-impact')))changed=true
    }
    if(changed)schedule()
  })
  function enable(value){
    if(enabled===value)return
    enabled=value
    if(enabled){collect(root);flush();mutations.observe(root,{childList:true,subtree:true});window.addEventListener('scroll',schedule,true);root.addEventListener('pointerover',schedule);root.addEventListener('pointerout',schedule);root.addEventListener('focusin',schedule);root.addEventListener('focusout',schedule);window.addEventListener('resize',schedule)}
    else{
      mutations.disconnect();resize.disconnect();cancelAnimationFrame(frame);frame=0
      window.removeEventListener('scroll',schedule,true);root.removeEventListener('pointerover',schedule);root.removeEventListener('pointerout',schedule);root.removeEventListener('focusin',schedule);root.removeEventListener('focusout',schedule);window.removeEventListener('resize',schedule)
      for(const node of watched){delete node.dataset.paperReady;delete node.dataset.surfaceReady;node.style.removeProperty('--surface-mask')}
      for(const board of layers.values())board.remove()
      for(const loop of hues)loop.style.removeProperty('--paper-hue')
      watched.clear();patches.clear();layers.clear();hues.clear()
    }
  }
  return {enable,dispose:()=>enable(false)}
}
