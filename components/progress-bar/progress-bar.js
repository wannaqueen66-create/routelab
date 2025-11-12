Component({
  options: {
    addGlobalClass: true
  },
  properties: {
    label: {
      type: String,
      value: ''
    },
    value: {
      type: String,
      value: ''
    },
    goal: {
      type: String,
      value: ''
    },
    percentage: {
      type: Number,
      value: 0
    },
    variant: {
      type: String,
      value: 'primary'
    },
    hint: {
      type: String,
      value: ''
    }
  },
  data: {
    clampedPercentage: 0
  },
  lifetimes: {
    attached() {
      this._updatePercentage(this.data.percentage);
    }
  },
  observers: {
    percentage(value) {
      this._updatePercentage(value);
    }
  },
  methods: {
    _updatePercentage(value) {
      const numeric = Number(value);
      const safe = Math.max(0, Math.min(100, Number.isNaN(numeric) ? 0 : numeric));
      if (safe !== this.data.clampedPercentage) {
        this.setData({ clampedPercentage: safe });
      }
    }
  }
});
