// popup 弹窗视口适配:设计尺寸 800×600,窗口打开后再检测真实视口,
// 小于设计值(浏览器缩放≠100%、浏览器对弹窗宽度的钳制等)时把布局收缩到视口,
// 消除固定 800px 布局撑出的横向白边与滚动条。
// 注意:不能在打开阶段用 innerWidth/100vw 参与布局 —— 弹窗尺寸计算期
// 临时视口不可信,会把弹窗算成极小尺寸;因此默认值固定,就绪后才收缩。
;(function () {
  var DESIGN_W = 800
  var DESIGN_H = 600
  var root = document.documentElement

  function fit() {
    var w = window.innerWidth
    var h = window.innerHeight
    if (w > 0 && w < DESIGN_W) root.style.setProperty('--popup-w', w + 'px')
    else root.style.removeProperty('--popup-w')
    if (h > 0 && h < DESIGN_H) root.style.setProperty('--popup-h', h + 'px')
    else root.style.removeProperty('--popup-h')
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fit)
    window.addEventListener('load', fit)
  } else {
    fit()
  }
  window.addEventListener('resize', fit)
})()
