export default function QualityMetrics({ metrics, loading }) {
  const snapshot = metrics || {};
  const {
    totalPoints = 0,
    interpPoints = 0,
    backgroundPoints = 0,
    screenOffPoints = 0,
    weakSignalPoints = 0,
    resumeSpikeCount = 0,
    backgroundRatio = 0,
    interpRatio = 0,
    weakSignalRatio = 0,
  } = snapshot;

  const cards = [
    {
      label: '后台占比',
      value: backgroundRatio,
      formatter: (value) => `${(value * 100).toFixed(1)}%`,
      description: `后台: ${backgroundPoints} / 息屏: ${screenOffPoints}`,
    },
    {
      label: '推测占比',
      value: interpRatio,
      formatter: (value) => `${(value * 100).toFixed(1)}%`,
      description: `${interpPoints} 点`,
    },
    {
      label: '弱信号占比',
      value: weakSignalRatio,
      formatter: (value) => `${(value * 100).toFixed(1)}%`,
      description: `${weakSignalPoints} 点`,
    },
    {
      label: '挂起恢复次数',
      value: resumeSpikeCount,
      description: 'pausePoints.reason = suspension',
    },
  ];

  const renderValue = (card) => {
    if (!metrics) {
      return loading ? '加载…' : '—';
    }
    if (card.formatter) {
      return card.formatter(card.value);
    }
    return card.value;
  };

  return (
    <div className="admin-card quality-metrics-card">
      <div className="admin-card-title">轨迹质量指标</div>
      <div className="quality-metrics-grid">
        <div className="quality-metrics-total">
          <span>采样总量</span>
          <strong>{metrics ? totalPoints : loading ? '加载…' : '—'}</strong>
          <span className="quality-metrics-hint">route_points</span>
        </div>
        {cards.map((card) => (
          <div key={card.label} className="quality-metric">
            <span>{card.label}</span>
            <strong>{renderValue(card)}</strong>
            {card.description ? (
              <span className="quality-metric-sub">{card.description}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
