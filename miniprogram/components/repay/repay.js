/* 登记还款弹窗：金额输入 + 说明提示。
   原生 showModal 的 editable 模式会把 content 塞进输入框当初始值，
   说明文字没地方放，所以自己画一个。核销逻辑在页面侧（store.applyRepay）。 */
Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    show: Boolean,
    label: String,   // 卡片名，如「广州银行 ·1234」
    owed: String     // 待还金额（已格式化）
  },

  data: { amount: '' },

  observers: {
    show(v) { if (v) this.setData({ amount: '' }); }
  },

  methods: {
    onInput(e) { this.setData({ amount: e.detail.value }); },
    cancel() { this.triggerEvent('cancel'); },
    confirm() { this.triggerEvent('confirm', { amount: this.data.amount }); },
    noop() {}
  }
});
