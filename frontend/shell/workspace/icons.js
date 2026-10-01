const paths = {
  plus: ['M12 5v14', 'M5 12h14'], minus: ['M5 12h14'], close: ['M18 6 6 18', 'm6 6 12 12'],
  chevron: ['m6 9 6 6 6-6'], play: ['M9 5a1 1 0 0 1 1.5-.86l10 6a1 1 0 0 1 0 1.72l-10 6A1 1 0 0 1 9 17Z'],
  pause: ['M6 4h4v16H6z', 'M14 4h4v16h-4z'], stop: ['M5 5h14v14H5z'],
  pencil: ['m16 4 4 4', 'M4 20l4-1L20 7a2.83 2.83 0 0 0-4-4L4 15Z'],
  trash: ['M3 6h18', 'M9 6V4h6v2', 'm5 6 1 14h12l1-14', 'M10 10v6', 'M14 10v6'],
  archive: ['M3 3h18v4H3z', 'M5 7v14h14V7', 'M10 11h4'], chart: ['M5 20v-5', 'M12 20V9', 'M19 20V3'],
  clipboard: ['M9 5H5v16h14V5h-4', 'M9 3h6v4H9z', 'M9 12h6', 'M9 16h6'],
  folder: ['M3 7V5h6l2 2h10v13H3Z', 'M12 10v7', 'M8.5 13.5h7'],
  save: ['M19 21H5V3h12l4 4v14Z', 'M7 3v6h10V3', 'M8 21v-8h8v8'], check: ['m5 12 4 4L19 6'],
  rotate: ['M3 10V4', 'M3 4h6', 'M3 10a9 9 0 1 1 1 8'], write: ['M12 20H4V4h8', 'm16 3 5 5', 'm9 15 1-4L18 3a2.8 2.8 0 0 1 4 4l-8 8Z'],
}
export function icon(name, size = 15) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'})) svg.setAttribute(key, value)
  for (const d of paths[name]) {const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path)}
  return svg
}
