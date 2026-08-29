import tippy from 'tippy.js'
import type { Component } from 'vue'
import { createApp, h } from 'vue'

/**
 * 右键菜单服务(FR-2.3):tippy popover + 单键快捷字母,
 * @contextmenu.prevent 触发;点击项/外部/Esc/滚动关闭。
 */

export interface ContextMenuItem {
  key: string
  label: string
  /** 单键快捷字母(菜单打开时按下即触发) */
  shortcut?: string
  icon?: Component
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  handler: () => void
}

let activeCleanup: (() => void) | null = null

function closeActiveMenu() {
  if (activeCleanup) {
    activeCleanup()
    activeCleanup = null
  }
}

export function isContextMenuOpen(): boolean {
  return activeCleanup !== null
}

export function openContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
  event.preventDefault()
  closeActiveMenu()
  if (!items.length) return

  const host = document.createElement('div')
  host.className = 'apifix-ctx-menu'
  document.body.appendChild(host)

  const menuEl = document.createElement('div')
  host.appendChild(menuEl)

  const VNode = {
    render() {
      return h('div', { class: 'ctx-menu-list' }, items.map(item => [
        item.separatorBefore ? h('div', { class: 'ctx-menu-sep' }) : null,
        h('button', {
          class: ['ctx-menu-item', { danger: item.danger, disabled: item.disabled }],
          disabled: item.disabled,
          onClick: (e: MouseEvent) => {
            e.stopPropagation()
            if (item.disabled) return
            closeActiveMenu()
            item.handler()
          },
        }, [
          item.icon ? h(item.icon, { size: 14 }) : h('span', { class: 'ctx-menu-icon-spacer' }),
          h('span', { class: 'ctx-menu-label' }, item.label),
          item.shortcut ? h('kbd', { class: 'ctx-menu-kbd' }, item.shortcut) : null,
        ]),
      ]))
    },
  }
  createApp(VNode).mount(menuEl)

  let keyHandler: ((e: KeyboardEvent) => void) | null = null

  const instance = tippy(document.body, {
    getReferenceClientRect: () => new DOMRect(event.clientX, event.clientY, 0, 0),
    appendTo: () => document.body,
    content: host,
    trigger: 'manual',
    interactive: true,
    theme: 'popover',
    placement: 'right-start',
    offset: [2, 2],
    arrow: false,
    zIndex: 1400,
    onShow() {
      // 边缘翻转:靠近右/下边界时换方向
      const box = host.firstElementChild?.getBoundingClientRect()
      if (box) {
        if (event.clientX + box.width > window.innerWidth - 8) instance.setProps({ placement: 'left-start' })
        if (event.clientY + box.height > window.innerHeight - 8) {
          instance.setProps({ placement: instance.props.placement === 'left-start' ? 'left-end' : 'right-end' })
        }
      }
    },
  })
  instance.show()

  keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault()
      closeActiveMenu()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const key = e.key.toLowerCase()
    const match = items.find(item => item.shortcut && item.shortcut.toLowerCase() === key && !item.disabled)
    if (match) {
      e.preventDefault()
      closeActiveMenu()
      match.handler()
    }
  }
  const onClickAway = (e: MouseEvent) => {
    const target = e.target as Node
    if (host.contains(target)) return
    closeActiveMenu()
  }
  const onScroll = () => closeActiveMenu()

  document.addEventListener('keydown', keyHandler, true)
  document.addEventListener('mousedown', onClickAway, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)

  activeCleanup = () => {
    document.removeEventListener('keydown', keyHandler!, true)
    document.removeEventListener('mousedown', onClickAway, true)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onScroll)
    try { instance.hide(); instance.unmount() } catch { /* 已销毁 */ }
    host.remove()
  }
}

export { closeActiveMenu as closeContextMenu }
