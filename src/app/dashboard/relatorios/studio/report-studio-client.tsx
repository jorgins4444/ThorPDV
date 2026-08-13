'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import {
  reportStudioDelete,
  reportStudioGet,
  reportStudioList,
  reportStudioRun,
  reportStudioSave,
} from './actions';
import {
  studioSourceMap,
  studioSources,
  type StudioFormat,
} from './report-studio-catalog';

type Row = Record<string, unknown>;
type Size = 's' | 'm' | 'l' | 'wide';
type Agg = 'sum' | 'avg' | 'count' | 'min' | 'max';
type CompareMode = 'none' | 'previous' | 'year' | 'custom';
type Chart =
  | 'kpi'
  | 'bar'
  | 'column'
  | 'line'
  | 'area'
  | 'donut'
  | 'pie'
  | 'table'
  | 'gauge'
  | 'radial'
  | 'funnel'
  | 'treemap'
  | 'heatmap'
  | 'waterfall'
  | 'combo'
  | 'scatter'
  | 'radar'
  | 'spark';

type Card = {
  id: string;
  source: string;
  title: string;
  metric: string;
  dimension: string;
  aggregation: Agg;
  chart: Chart;
  color: string;
  size: Size;
  compare: boolean;
  filterField: string;
  filterValue: string;
  blendSource: string;
  blendMetric: string;
  blendAggregation: Agg;
  visible: boolean;
};

type Point = { label: string; value: number };
type Loaded = Record<string, { current: Row[]; comparison: Row[] }>;
type Workbook = { id: string; name: string; is_default?: boolean; updated_at?: string };
type Branch = { id?: unknown; name?: unknown };
type Cross = { field: string; value: string } | null;

const chartOptions: Chart[] = [
  'kpi', 'bar', 'column', 'line', 'area', 'donut', 'pie', 'table', 'gauge',
  'radial', 'funnel', 'treemap', 'heatmap', 'waterfall', 'combo', 'scatter',
  'radar', 'spark',
];

const chartLabels: Record<Chart, string> = {
  kpi: 'Indicador',
  bar: 'Barras horizontais',
  column: 'Colunas',
  line: 'Linha',
  area: 'Área',
  donut: 'Rosca',
  pie: 'Pizza',
  table: 'Tabela',
  gauge: 'Velocímetro',
  radial: 'Radial',
  funnel: 'Funil',
  treemap: 'Treemap',
  heatmap: 'Mapa de calor',
  waterfall: 'Cascata',
  combo: 'Combinado',
  scatter: 'Dispersão',
  radar: 'Radar',
  spark: 'Sparkline',
};

const sizeLabels: Record<Size, string> = {
  s: 'Pequeno',
  m: 'Médio',
  l: 'Grande',
  wide: 'Largura total',
};

const aggLabels: Record<Agg, string> = {
  sum: 'Soma',
  avg: 'Média',
  count: 'Contagem',
  min: 'Mínimo',
  max: 'Máximo',
};

const refreshOptions = [
  [0, 'Manual'],
  [15, '15 segundos'],
  [30, '30 segundos'],
  [60, '1 minuto'],
  [300, '5 minutos'],
  [900, '15 minutos'],
] as const;

const palette = [
  '#6d28d9', '#2563eb', '#059669', '#d97706', '#dc2626',
  '#0891b2', '#7c3aed', '#db2777', '#475569', '#0f766e',
];

const uid = () => `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const pad = (n: number) => String(n).padStart(2, '0');
const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function iso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function today() {
  return iso(new Date());
}

function monthStart() {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth(), 1));
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function previousRange(start: string, end: string) {
  const first = parseDate(start);
  const last = parseDate(end);
  const days = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000) + 1);
  const compareEnd = new Date(first);
  compareEnd.setDate(compareEnd.getDate() - 1);
  const compareStart = new Date(compareEnd);
  compareStart.setDate(compareStart.getDate() - days + 1);
  return [iso(compareStart), iso(compareEnd)] as const;
}

function yearRange(start: string, end: string) {
  const first = parseDate(start);
  const last = parseDate(end);
  first.setFullYear(first.getFullYear() - 1);
  last.setFullYear(last.getFullYear() - 1);
  return [iso(first), iso(last)] as const;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
}

function formatValue(value: number, format?: StudioFormat) {
  if (format === 'money') {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === 'percent') return `${formatNumber(value)}%`;
  return formatNumber(value);
}

function rgba(hex: string, alpha: number) {
  const clean = hex.replace('#', '');
  const value = parseInt(clean, 16);
  if (!Number.isFinite(value)) return `rgba(109,40,217,${alpha})`;
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function aggregate(rows: Row[], key: string, agg: Agg) {
  if (agg === 'count') return rows.length;
  const values = rows.map((row) => num(row[key]));
  if (!values.length) return 0;
  if (agg === 'avg') return values.reduce((a, b) => a + b, 0) / values.length;
  if (agg === 'min') return Math.min(...values);
  if (agg === 'max') return Math.max(...values);
  return values.reduce((a, b) => a + b, 0);
}

function percentDelta(current: number, comparison: number) {
  if (comparison === 0) return current === 0 ? 0 : null;
  return ((current - comparison) / Math.abs(comparison)) * 100;
}

function metricFormat(card: Card, blend = false) {
  const source = studioSourceMap[blend ? card.blendSource : card.source];
  const key = blend ? card.blendMetric : card.metric;
  return source?.metrics.find((metric) => metric.key === key)?.format;
}

function defaultCard(sourceId = 'product_ranking'): Card {
  const source = studioSourceMap[sourceId] ?? studioSources[0];
  return {
    id: uid(),
    source: source.id,
    title: source.title,
    metric: source.metrics[0]?.key ?? '',
    dimension: source.dimensions[0]?.key ?? '',
    aggregation: 'sum',
    chart: 'bar',
    color: palette[Math.floor(Math.random() * palette.length)],
    size: 'l',
    compare: true,
    filterField: '',
    filterValue: '',
    blendSource: '',
    blendMetric: '',
    blendAggregation: 'sum',
    visible: true,
  };
}

const initialCards: Card[] = [
  { ...defaultCard('product_ranking'), id: 'products', title: 'Produtos mais vendidos', metric: 'revenue', dimension: 'product', chart: 'bar', color: '#059669' },
  { ...defaultCard('payment_methods'), id: 'payments', title: 'Vendas por forma de pagamento', metric: 'amount', dimension: 'payment_method', chart: 'donut', color: '#2563eb' },
  { ...defaultCard('gross_profit'), id: 'profit', title: 'Lucro bruto ao longo do período', metric: 'gross_profit', dimension: 'report_day', chart: 'area', size: 'wide', color: '#6d28d9' },
  { ...defaultCard('sellers'), id: 'sellers', title: 'Desempenho por vendedor', metric: 'revenue', dimension: 'seller', chart: 'column', color: '#d97706' },
  { ...defaultCard('cash_flow'), id: 'cashflow', title: 'Saldo realizado', metric: 'realized_balance', dimension: 'report_day', chart: 'line', color: '#0891b2' },
  { ...defaultCard('receivables'), id: 'receivables', title: 'Contas a receber em aberto', metric: 'open_amount', dimension: '', chart: 'kpi', size: 'm', color: '#dc2626' },
];

function applyFilters(rows: Row[], card: Card, cross: Cross) {
  let result = rows;
  if (card.filterField && card.filterValue.trim()) {
    const query = card.filterValue.trim().toLocaleLowerCase('pt-BR');
    result = result.filter((row) =>
      String(row[card.filterField] ?? '').toLocaleLowerCase('pt-BR').includes(query),
    );
  }
  if (cross && studioSourceMap[card.source]?.dimensions.some((field) => field.key === cross.field)) {
    result = result.filter((row) => String(row[cross.field] ?? '') === cross.value);
  }
  return result;
}

function buildPoints(rows: Row[], card: Card) {
  if (!card.dimension) {
    return [{ label: 'Total', value: aggregate(rows, card.metric, card.aggregation) }];
  }

  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const label = String(row[card.dimension] ?? 'Não informado');
    const bucket = grouped.get(label) ?? [];
    bucket.push(row);
    grouped.set(label, bucket);
  }

  const points = [...grouped.entries()].map(([label, group]) => ({
    label,
    value: aggregate(group, card.metric, card.aggregation),
  }));

  const dimension = studioSourceMap[card.source]?.dimensions.find((field) => field.key === card.dimension);
  if (dimension?.format === 'date' || card.dimension.includes('day') || card.dimension.includes('date')) {
    return points.slice(-30);
  }

  return points.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 20);
}

function Empty() {
  return <div className="rs-empty">Sem dados para esta combinação.</div>;
}

function KpiVisual({ card, current, comparison }: { card: Card; current: Point[]; comparison: Point[] }) {
  const currentValue = current.reduce((sum, point) => sum + point.value, 0);
  const previousValue = comparison.reduce((sum, point) => sum + point.value, 0);
  const change = comparison.length ? percentDelta(currentValue, previousValue) : null;
  return (
    <div className="rs-kpi">
      <span>{studioSourceMap[card.source]?.metrics.find((metric) => metric.key === card.metric)?.label ?? 'Indicador'}</span>
      <strong>{formatValue(currentValue, metricFormat(card))}</strong>
      {change !== null ? (
        <em className={change >= 0 ? 'up' : 'down'}>
          {change >= 0 ? '↑' : '↓'} {formatNumber(Math.abs(change))}% vs. comparação
        </em>
      ) : null}
      <small>{card.blendSource ? 'Comparativo entre relatórios' : `Agregação: ${aggLabels[card.aggregation]}`}</small>
    </div>
  );
}

function BarVisual({ current, comparison, color, onPick }: { current: Point[]; comparison: Point[]; color: string; onPick: (label: string) => void }) {
  if (!current.length) return <Empty />;
  const max = Math.max(1, ...current.map((point) => Math.abs(point.value)), ...comparison.map((point) => Math.abs(point.value)));
  const comparisonMap = new Map(comparison.map((point) => [point.label, point.value]));
  return (
    <div className="rs-bars">
      {current.slice(0, 12).map((point) => (
        <button key={point.label} className="rs-bar" onClick={() => onPick(point.label)}>
          <div><span>{point.label}</span><b>{formatNumber(point.value)}</b></div>
          <div className="rs-track">
            <i style={{ width: `${Math.max(2, Math.abs(point.value) / max * 100)}%`, background: color }} />
            {comparisonMap.has(point.label) ? (
              <em style={{ width: `${Math.max(2, Math.abs(comparisonMap.get(point.label) ?? 0) / max * 100)}%` }} />
            ) : null}
          </div>
        </button>
      ))}
    </div>
  );
}

function ColumnVisual({ current, comparison, color, onPick }: { current: Point[]; comparison: Point[]; color: string; onPick: (label: string) => void }) {
  if (!current.length) return <Empty />;
  const points = current.slice(0, 14);
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)), ...comparison.map((point) => Math.abs(point.value)));
  const comparisonMap = new Map(comparison.map((point) => [point.label, point.value]));
  return (
    <div className="rs-columns">
      {points.map((point) => (
        <button key={point.label} onClick={() => onPick(point.label)}>
          <div className="rs-col-bars">
            <i style={{ height: `${Math.max(3, Math.abs(point.value) / max * 100)}%`, background: color }} />
            <em style={{ height: `${Math.max(0, Math.abs(comparisonMap.get(point.label) ?? 0) / max * 100)}%` }} />
          </div>
          <span>{point.label}</span>
        </button>
      ))}
    </div>
  );
}

function LineVisual({ current, comparison, color, area = false, spark = false }: { current: Point[]; comparison: Point[]; color: string; area?: boolean; spark?: boolean }) {
  const points = current.slice(-30);
  if (!points.length) return <Empty />;
  const comparePoints = comparison.slice(-30);
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)), ...comparePoints.map((point) => Math.abs(point.value)));
  const width = 720;
  const height = spark ? 90 : 230;
  const padding = spark ? 5 : 18;

  const coords = (items: Point[]) => items.map((point, index) => {
    const x = padding + (items.length <= 1 ? 0 : index * (width - padding * 2) / (items.length - 1));
    const y = height - padding - Math.abs(point.value) / max * (height - padding * 2);
    return [x, y] as const;
  });

  const currentCoords = coords(points);
  const compareCoords = coords(comparePoints);
  const polyline = currentCoords.map(([x, y]) => `${x},${y}`).join(' ');
  const compareLine = compareCoords.map(([x, y]) => `${x},${y}`).join(' ');
  const areaPath = currentCoords.length
    ? `M ${currentCoords[0][0]} ${height - padding} L ${currentCoords.map(([x, y]) => `${x} ${y}`).join(' L ')} L ${currentCoords[currentCoords.length - 1][0]} ${height - padding} Z`
    : '';

  return (
    <div className={spark ? 'rs-spark' : 'rs-line'}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {!spark ? [0.25, 0.5, 0.75, 1].map((ratio) => (
          <line key={ratio} x1={padding} x2={width - padding} y1={height - padding - (height - padding * 2) * ratio} y2={height - padding - (height - padding * 2) * ratio} className="rs-gridline" />
        )) : null}
        {area && areaPath ? <path d={areaPath} fill={rgba(color, 0.14)} /> : null}
        {compareLine ? <polyline points={compareLine} fill="none" stroke="#94a3b8" strokeWidth={spark ? 2 : 3} strokeDasharray="8 7" /> : null}
        <polyline points={polyline} fill="none" stroke={color} strokeWidth={spark ? 3 : 4} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!spark ? <div className="rs-axis"><span>{points[0]?.label}</span><span>{points[Math.floor(points.length / 2)]?.label}</span><span>{points[points.length - 1]?.label}</span></div> : null}
    </div>
  );
}

function DonutVisual({ current, comparison, color, pie = false, onPick }: { current: Point[]; comparison: Point[]; color: string; pie?: boolean; onPick: (label: string) => void }) {
  const points = current.filter((point) => point.value > 0).slice(0, 8);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  if (!total) return <Empty />;
  let cursor = 0;
  const stops = points.map((point, index) => {
    const start = cursor;
    cursor += point.value / total * 100;
    return `${index === 0 ? color : palette[index % palette.length]} ${start}% ${cursor}%`;
  }).join(',');
  const previousTotal = comparison.reduce((sum, point) => sum + point.value, 0);
  const change = previousTotal ? percentDelta(total, previousTotal) : null;

  return (
    <div className="rs-donut-layout">
      <div className={`rs-donut ${pie ? 'is-pie' : ''}`} style={{ background: `conic-gradient(${stops})` }}>
        {!pie ? <div><b>{formatNumber(total)}</b><span>{change === null ? 'Total' : `${formatNumber(change)}% vs. B`}</span></div> : null}
      </div>
      <div className="rs-legend">
        {points.map((point, index) => (
          <button key={point.label} onClick={() => onPick(point.label)}>
            <i style={{ background: index === 0 ? color : palette[index % palette.length] }} />
            <span>{point.label}</span>
            <b>{formatNumber(point.value)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function TableVisual({ current, comparison, onPick }: { current: Point[]; comparison: Point[]; onPick: (label: string) => void }) {
  if (!current.length) return <Empty />;
  const comparisonMap = new Map(comparison.map((point) => [point.label, point.value]));
  return (
    <div className="rs-table">
      <div className="rs-table-head"><span>Dimensão</span><span>Atual</span><span>Comparação</span><span>Δ</span></div>
      {current.slice(0, 15).map((point) => {
        const previous = comparisonMap.get(point.label) ?? 0;
        const change = percentDelta(point.value, previous);
        return (
          <button key={point.label} onClick={() => onPick(point.label)}>
            <span>{point.label}</span>
            <b>{formatNumber(point.value)}</b>
            <span>{previous ? formatNumber(previous) : '—'}</span>
            <em className={change !== null && change >= 0 ? 'up' : 'down'}>{change === null ? '—' : `${change >= 0 ? '+' : ''}${formatNumber(change)}%`}</em>
          </button>
        );
      })}
    </div>
  );
}

function GaugeVisual({ current, comparison, color }: { current: Point[]; comparison: Point[]; color: string }) {
  const value = current.reduce((sum, point) => sum + point.value, 0);
  const previous = comparison.reduce((sum, point) => sum + point.value, 0);
  const ceiling = Math.max(1, Math.abs(value), Math.abs(previous)) * 1.2;
  const fill = Math.min(100, Math.abs(value) / ceiling * 100);
  const change = previous ? percentDelta(value, previous) : null;
  return (
    <div className="rs-gauge">
      <div style={{ background: `conic-gradient(${color} 0 ${fill}%,#eef2f6 ${fill}% 100%)` }}>
        <span><b>{formatNumber(value)}</b><small>{change === null ? 'Atual' : `${formatNumber(change)}% vs. B`}</small></span>
      </div>
    </div>
  );
}

function FunnelVisual({ current, color, onPick }: { current: Point[]; color: string; onPick: (label: string) => void }) {
  const points = [...current].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 9);
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  if (!points.length) return <Empty />;
  return (
    <div className="rs-funnel">
      {points.map((point, index) => (
        <button
          key={point.label}
          onClick={() => onPick(point.label)}
          style={{
            width: `${35 + Math.abs(point.value) / max * 65}%`,
            background: rgba(color, 0.12 + index * 0.035),
            borderColor: rgba(color, 0.26),
          }}
        >
          <span>{point.label}</span><b>{formatNumber(point.value)}</b>
        </button>
      ))}
    </div>
  );
}

function TileVisual({ current, color, heatmap = false, onPick }: { current: Point[]; color: string; heatmap?: boolean; onPick: (label: string) => void }) {
  const points = current.slice(0, heatmap ? 24 : 12);
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  if (!points.length) return <Empty />;
  if (heatmap) {
    return (
      <div className="rs-heatmap">
        {points.map((point) => (
          <button key={point.label} onClick={() => onPick(point.label)} style={{ background: rgba(color, 0.08 + 0.78 * Math.abs(point.value) / max) }}>
            <span>{point.label}</span><b>{formatNumber(point.value)}</b>
          </button>
        ))}
      </div>
    );
  }
  const sum = points.reduce((total, point) => total + Math.abs(point.value), 0);
  return (
    <div className="rs-treemap">
      {points.map((point, index) => (
        <button
          key={point.label}
          onClick={() => onPick(point.label)}
          style={{
            flexGrow: Math.max(0.25, Math.abs(point.value) / Math.max(1, sum) * 8),
            background: rgba(index ? palette[index % palette.length] : color, 0.12),
            borderColor: rgba(index ? palette[index % palette.length] : color, 0.3),
          }}
        >
          <span>{point.label}</span><b>{formatNumber(point.value)}</b>
        </button>
      ))}
    </div>
  );
}

function ScatterVisual({ current, comparison, color }: { current: Point[]; comparison: Point[]; color: string }) {
  if (!current.length) return <Empty />;
  const points = current.slice(0, 18);
  const comparisonMap = new Map(comparison.map((point) => [point.label, point.value]));
  const xs = points.map((point, index) => Math.abs(comparisonMap.get(point.label) ?? index + 1));
  const ys = points.map((point) => Math.abs(point.value));
  const maxX = Math.max(1, ...xs);
  const maxY = Math.max(1, ...ys);
  return (
    <div className="rs-scatter">
      <svg viewBox="0 0 640 230">
        {points.map((point, index) => (
          <g key={point.label}>
            <circle cx={28 + xs[index] / maxX * 580} cy={205 - ys[index] / maxY * 175} r="7" fill={color} opacity="0.78" />
            <title>{`${point.label}: ${formatNumber(point.value)}`}</title>
          </g>
        ))}
      </svg>
      <div><span>{comparison.length ? 'X: comparação' : 'X: posição'}</span><span>Y: atual</span></div>
    </div>
  );
}

function RadarVisual({ current, comparison, color }: { current: Point[]; comparison: Point[]; color: string }) {
  const points = current.slice(0, 8);
  if (points.length < 3) return <BarVisual current={current} comparison={comparison} color={color} onPick={() => undefined} />;
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)), ...comparison.map((point) => Math.abs(point.value)));
  const centerX = 160;
  const centerY = 145;
  const radius = 105;
  const polygon = (values: Point[]) => points.map((point, index) => {
    const value = values.find((item) => item.label === point.label)?.value ?? 0;
    const angle = -Math.PI / 2 + index * 2 * Math.PI / points.length;
    const distance = Math.abs(value) / max * radius;
    return `${centerX + Math.cos(angle) * distance},${centerY + Math.sin(angle) * distance}`;
  }).join(' ');
  return (
    <div className="rs-radar">
      <svg viewBox="0 0 320 290">
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <polygon key={ratio} points={points.map((_, index) => {
            const angle = -Math.PI / 2 + index * 2 * Math.PI / points.length;
            return `${centerX + Math.cos(angle) * radius * ratio},${centerY + Math.sin(angle) * radius * ratio}`;
          }).join(' ')} fill="none" stroke="#e2e8f0" />
        ))}
        {comparison.length ? <polygon points={polygon(comparison)} fill="rgba(148,163,184,.1)" stroke="#94a3b8" /> : null}
        <polygon points={polygon(points)} fill={rgba(color, 0.14)} stroke={color} strokeWidth="2.5" />
      </svg>
    </div>
  );
}

function Visual({ card, current, comparison, onPick }: { card: Card; current: Point[]; comparison: Point[]; onPick: (label: string) => void }) {
  const compare = card.compare ? comparison : [];
  if (card.chart === 'kpi') return <KpiVisual card={card} current={current} comparison={compare} />;
  if (card.chart === 'bar') return <BarVisual current={current} comparison={compare} color={card.color} onPick={onPick} />;
  if (card.chart === 'column' || card.chart === 'waterfall') return <ColumnVisual current={current} comparison={compare} color={card.color} onPick={onPick} />;
  if (card.chart === 'line') return <LineVisual current={current} comparison={compare} color={card.color} />;
  if (card.chart === 'area') return <LineVisual current={current} comparison={compare} color={card.color} area />;
  if (card.chart === 'spark') return <LineVisual current={current} comparison={compare} color={card.color} spark />;
  if (card.chart === 'donut' || card.chart === 'radial') return <DonutVisual current={current} comparison={compare} color={card.color} onPick={onPick} />;
  if (card.chart === 'pie') return <DonutVisual current={current} comparison={compare} color={card.color} pie onPick={onPick} />;
  if (card.chart === 'table') return <TableVisual current={current} comparison={compare} onPick={onPick} />;
  if (card.chart === 'gauge') return <GaugeVisual current={current} comparison={compare} color={card.color} />;
  if (card.chart === 'funnel') return <FunnelVisual current={current} color={card.color} onPick={onPick} />;
  if (card.chart === 'treemap') return <TileVisual current={current} color={card.color} onPick={onPick} />;
  if (card.chart === 'heatmap') return <TileVisual current={current} color={card.color} heatmap onPick={onPick} />;
  if (card.chart === 'scatter') return <ScatterVisual current={current} comparison={compare} color={card.color} />;
  if (card.chart === 'radar') return <RadarVisual current={current} comparison={compare} color={card.color} />;
  return (
    <div className="rs-combo">
      <ColumnVisual current={current} comparison={[]} color={card.color} onPick={onPick} />
      <LineVisual current={compare.length ? compare : current} comparison={[]} color="#475569" spark />
    </div>
  );
}

export function ReportStudio({ branches }: { branches: Branch[] }) {
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [data, setData] = useState<Loaded>({});
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(today());
  const [branch, setBranch] = useState('');
  const [compareMode, setCompareMode] = useState<CompareMode>('previous');
  const [compareStart, setCompareStart] = useState('');
  const [compareEnd, setCompareEnd] = useState('');
  const [refresh, setRefresh] = useState(60);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(initialCards[0].id);
  const [cross, setCross] = useState<Cross>(null);
  const [workbooks, setWorkbooks] = useState<Workbook[]>([]);
  const [activeId, setActiveId] = useState('');
  const [name, setName] = useState('Meu painel gerencial');
  const [isDefault, setIsDefault] = useState(true);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const dragged = useRef<string | null>(null);

  const comparisonRange = useCallback(() => {
    if (compareMode === 'none') return ['', ''] as const;
    if (compareMode === 'custom') return [compareStart, compareEnd] as const;
    if (compareMode === 'year') return yearRange(start, end);
    return previousRange(start, end);
  }, [compareMode, compareStart, compareEnd, start, end]);

  const load = useCallback(async (announce = false) => {
    const sources = [...new Set(
      cards.filter((card) => card.visible).flatMap((card) => [card.source, card.blendSource]).filter(Boolean),
    )];
    const [comparisonStart, comparisonEnd] = comparisonRange();
    setLoading(true);
    const result = await reportStudioRun(
      sources,
      start,
      end,
      branch,
      comparisonStart || undefined,
      comparisonEnd || undefined,
    );
    setLoading(false);
    if (result.ok) {
      setData(result.sources);
      if (announce) setMessage('Análises atualizadas.');
    } else {
      setMessage(result.error ?? 'Falha ao atualizar análises.');
    }
  }, [cards, start, end, branch, comparisonRange]);

  useEffect(() => {
    let active = true;
    void reportStudioList().then(async (result) => {
      if (!active) return;
      const list = Array.isArray(result.workbooks) ? result.workbooks as Workbook[] : [];
      setWorkbooks(list);
      if (!list[0]?.id) return;
      const loaded = await reportStudioGet(list[0].id);
      if (!active) return;
      const workbook = loaded.workbook as Record<string, unknown> | null;
      if (!workbook) return;
      const layout = Array.isArray(workbook.layout) ? workbook.layout as Card[] : [];
      if (layout.length) setCards(layout);
      const settings = workbook.settings && typeof workbook.settings === 'object' ? workbook.settings as Record<string, unknown> : {};
      setActiveId(String(workbook.id ?? ''));
      setName(String(workbook.name ?? 'Meu painel gerencial'));
      setIsDefault(Boolean(workbook.is_default));
      if (settings.start) setStart(String(settings.start));
      if (settings.end) setEnd(String(settings.end));
      if (settings.branch) setBranch(String(settings.branch));
      if (settings.compareMode) setCompareMode(String(settings.compareMode) as CompareMode);
      if (settings.compareStart) setCompareStart(String(settings.compareStart));
      if (settings.compareEnd) setCompareEnd(String(settings.compareEnd));
      if (settings.refresh !== undefined) setRefresh(Number(settings.refresh) || 0);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(false); }, 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (refresh <= 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false);
    }, refresh * 1000);
    return () => window.clearInterval(timer);
  }, [refresh, load]);

  const selectedCard = cards.find((card) => card.id === selected) ?? cards[0];

  function rowsFor(card: Card, period: 'current' | 'comparison', blend = false) {
    const source = blend ? card.blendSource : card.source;
    const rows = data[source]?.[period] ?? [];
    return blend ? rows : applyFilters(rows, card, cross);
  }

  function pointsFor(card: Card, period: 'current' | 'comparison') {
    if (card.blendSource && card.blendMetric) {
      const primary = aggregate(rowsFor(card, period), card.metric, card.aggregation);
      const secondary = aggregate(rowsFor(card, period, true), card.blendMetric, card.blendAggregation);
      return [
        { label: studioSourceMap[card.source]?.title ?? 'Fonte A', value: primary },
        { label: studioSourceMap[card.blendSource]?.title ?? 'Fonte B', value: secondary },
      ];
    }
    return buildPoints(rowsFor(card, period), card);
  }

  function updateCard(id: string, patch: Partial<Card>) {
    setCards((current) => current.map((card) => card.id === id ? { ...card, ...patch } : card));
  }

  function addCard() {
    const card = defaultCard();
    setCards((current) => [...current, card]);
    setSelected(card.id);
    setEditing(true);
  }

  function removeCard(id: string) {
    setCards((current) => current.filter((card) => card.id !== id));
    if (selected === id) setSelected(cards.find((card) => card.id !== id)?.id ?? '');
  }

  function dropOn(target: string) {
    const source = dragged.current;
    if (!source || source === target) return;
    setCards((current) => {
      const copy = [...current];
      const from = copy.findIndex((card) => card.id === source);
      const to = copy.findIndex((card) => card.id === target);
      if (from < 0 || to < 0) return current;
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
    dragged.current = null;
  }

  function preset(kind: 'today' | '7d' | '30d' | 'month') {
    const last = new Date();
    const first = new Date(last);
    if (kind === '7d') first.setDate(last.getDate() - 6);
    if (kind === '30d') first.setDate(last.getDate() - 29);
    if (kind === 'month') first.setDate(1);
    setStart(kind === 'today' ? iso(last) : iso(first));
    setEnd(iso(last));
  }

  async function saveWorkbook() {
    setSaving(true);
    const result = await reportStudioSave(
      activeId || undefined,
      name,
      cards,
      { start, end, branch, compareMode, compareStart, compareEnd, refresh },
      isDefault,
    );
    setSaving(false);
    if (!result.ok) {
      setMessage(String(result.error ?? 'Falha ao salvar.'));
      return;
    }
    setActiveId(String(result.id ?? activeId));
    setMessage('Workbook salvo.');
    const list = await reportStudioList();
    setWorkbooks(Array.isArray(list.workbooks) ? list.workbooks as Workbook[] : []);
  }

  async function openWorkbook(id: string) {
    if (!id) {
      setActiveId('');
      setName('Novo workbook');
      setCards(initialCards.map((card) => ({ ...card, id: uid() })));
      return;
    }
    const result = await reportStudioGet(id);
    const workbook = result.workbook as Record<string, unknown> | null;
    if (!workbook) return;
    const layout = Array.isArray(workbook.layout) ? workbook.layout as Card[] : [];
    setActiveId(id);
    setName(String(workbook.name ?? 'Workbook'));
    setIsDefault(Boolean(workbook.is_default));
    if (layout.length) setCards(layout);
    const settings = workbook.settings && typeof workbook.settings === 'object' ? workbook.settings as Record<string, unknown> : {};
    if (settings.start) setStart(String(settings.start));
    if (settings.end) setEnd(String(settings.end));
    setBranch(String(settings.branch ?? ''));
    setCompareMode((settings.compareMode as CompareMode) ?? 'previous');
    setCompareStart(String(settings.compareStart ?? ''));
    setCompareEnd(String(settings.compareEnd ?? ''));
    setRefresh(Number(settings.refresh ?? 60));
  }

  async function deleteWorkbook() {
    if (!activeId) return;
    const result = await reportStudioDelete(activeId);
    if (!result.ok) return;
    setActiveId('');
    setName('Novo workbook');
    setCards(initialCards.map((card) => ({ ...card, id: uid() })));
    setMessage('Workbook removido.');
    const list = await reportStudioList();
    setWorkbooks(Array.isArray(list.workbooks) ? list.workbooks as Workbook[] : []);
  }

  return (
    <div className="report-studio">
      <section className="rs-hero">
        <div>
          <span className="rs-eyebrow">THOR BI · REPORT STUDIO</span>
          <h2>Monte análises do seu jeito</h2>
          <p>Combine fontes, compare períodos e relatórios, altere métricas, dimensões, agregações, filtros e visuais sem mexer na origem dos dados.</p>
        </div>
        <div className="rs-live"><i className={loading ? 'loading' : ''} /><div><b>{loading ? 'Atualizando' : 'Dados conectados'}</b><span>{refresh ? `Auto · ${refresh}s` : 'Manual'}</span></div></div>
      </section>

      <section className="rs-workbook-bar">
        <label><span>Workbook</span><select value={activeId} onChange={(event) => { void openWorkbook(event.target.value); }}><option value="">+ Novo workbook</option>{workbooks.map((workbook) => <option value={workbook.id} key={workbook.id}>{workbook.is_default ? '★ ' : ''}{workbook.name}</option>)}</select></label>
        <label className="rs-name"><span>Nome</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="rs-check"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /><span>Usar como padrão</span></label>
        <button className="rs-save" disabled={saving} onClick={() => { void saveWorkbook(); }}>{saving ? 'Salvando…' : 'Salvar workbook'}</button>
        {activeId ? <button className="rs-delete" onClick={() => { void deleteWorkbook(); }}>Excluir</button> : null}
      </section>

      <section className="rs-toolbar">
        <div className="rs-presets"><button onClick={() => preset('today')}>Hoje</button><button onClick={() => preset('7d')}>7 dias</button><button onClick={() => preset('30d')}>30 dias</button><button onClick={() => preset('month')}>Mês</button></div>
        <label><span>Início</span><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label><span>Fim</span><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <label><span>Filial</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">Todas</option>{branches.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name ?? 'Filial')}</option>)}</select></label>
        <label><span>Comparar</span><select value={compareMode} onChange={(event) => setCompareMode(event.target.value as CompareMode)}><option value="none">Sem comparação</option><option value="previous">Período anterior</option><option value="year">Mesmo período ano anterior</option><option value="custom">Período B personalizado</option></select></label>
        {compareMode === 'custom' ? <><label><span>B início</span><input type="date" value={compareStart} onChange={(event) => setCompareStart(event.target.value)} /></label><label><span>B fim</span><input type="date" value={compareEnd} onChange={(event) => setCompareEnd(event.target.value)} /></label></> : null}
        <label><span>Atualização</span><select value={refresh} onChange={(event) => setRefresh(Number(event.target.value))}>{refreshOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <button className="rs-refresh" onClick={() => { void load(true); }}>↻ Atualizar</button>
        <button className="rs-add" onClick={addCard}>＋ Adicionar análise</button>
        <button className={`rs-edit ${editing ? 'active' : ''}`} onClick={() => setEditing((value) => !value)}>⚙ Personalizar</button>
      </section>

      {cross ? <div className="rs-cross"><b>Filtro cruzado:</b><span>{cross.field} = {cross.value}</span><button onClick={() => setCross(null)}>Limpar ×</button></div> : null}
      {message ? <div className="rs-message">{message}</div> : null}

      <section className={`rs-canvas ${editing ? 'editing' : ''}`}>
        {cards.filter((card) => card.visible).map((card) => {
          const current = pointsFor(card, 'current');
          const comparison = compareMode === 'none' ? [] : pointsFor(card, 'comparison');
          return (
            <article
              key={card.id}
              className={`rs-card size-${card.size}`}
              style={{ '--accent': card.color, '--soft': rgba(card.color, 0.08) } as CSSProperties}
              draggable={editing}
              onDragStart={() => { dragged.current = card.id; }}
              onDragOver={(event: DragEvent<HTMLElement>) => { if (editing) event.preventDefault(); }}
              onDrop={() => dropOn(card.id)}
            >
              <header>
                <div><span>{studioSourceMap[card.source]?.group} · {chartLabels[card.chart]}</span><h3>{card.title}</h3><small>{studioSourceMap[card.source]?.title}{card.blendSource ? ` × ${studioSourceMap[card.blendSource]?.title}` : ''}</small></div>
                {editing ? <div className="rs-card-tools"><button title="Mover">⠿</button><button title="Editar" onClick={() => { setSelected(card.id); setEditing(true); }}>⚙</button><button title="Remover" onClick={() => removeCard(card.id)}>×</button></div> : <i />}
              </header>
              <div className="rs-card-body"><Visual card={card} current={current} comparison={comparison} onPick={(label) => { if (card.dimension && !card.blendSource) setCross((old) => old?.field === card.dimension && old.value === label ? null : { field: card.dimension, value: label }); }} /></div>
              {card.compare && compareMode !== 'none' ? <footer><span className="rs-dot current" />Atual <span className="rs-dot previous" />Comparação</footer> : null}
            </article>
          );
        })}
      </section>

      {editing && selectedCard ? (
        <aside className="rs-editor">
          <header><div><span>PERSONALIZAÇÃO</span><h3>Análise</h3></div><button onClick={() => setEditing(false)}>×</button></header>
          <div className="rs-editor-scroll">
            <label>Título<input value={selectedCard.title} onChange={(event) => updateCard(selectedCard.id, { title: event.target.value })} /></label>
            <label>Fonte de dados<select value={selectedCard.source} onChange={(event) => { const source = studioSourceMap[event.target.value]; updateCard(selectedCard.id, { source: source.id, title: source.title, metric: source.metrics[0]?.key ?? '', dimension: source.dimensions[0]?.key ?? '', filterField: '', filterValue: '' }); }}>{studioSources.map((source) => <option key={source.id} value={source.id}>{source.group} · {source.title}</option>)}</select></label>
            <div className="rs-editor-grid">
              <label>Métrica<select value={selectedCard.metric} onChange={(event) => updateCard(selectedCard.id, { metric: event.target.value })}>{studioSourceMap[selectedCard.source]?.metrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label>
              <label>Agregação<select value={selectedCard.aggregation} onChange={(event) => updateCard(selectedCard.id, { aggregation: event.target.value as Agg })}>{(Object.keys(aggLabels) as Agg[]).map((agg) => <option key={agg} value={agg}>{aggLabels[agg]}</option>)}</select></label>
            </div>
            <label>Dimensão / eixo<select value={selectedCard.dimension} onChange={(event) => updateCard(selectedCard.id, { dimension: event.target.value })}><option value="">Sem dimensão · total</option>{studioSourceMap[selectedCard.source]?.dimensions.map((dimension) => <option key={dimension.key} value={dimension.key}>{dimension.label}</option>)}</select></label>
            <div className="rs-editor-grid">
              <label>Visual<select value={selectedCard.chart} onChange={(event) => updateCard(selectedCard.id, { chart: event.target.value as Chart })}>{chartOptions.map((chart) => <option key={chart} value={chart}>{chartLabels[chart]}</option>)}</select></label>
              <label>Tamanho<select value={selectedCard.size} onChange={(event) => updateCard(selectedCard.id, { size: event.target.value as Size })}>{(Object.keys(sizeLabels) as Size[]).map((size) => <option value={size} key={size}>{sizeLabels[size]}</option>)}</select></label>
            </div>
            <label>Cor<div className="rs-color"><input type="color" value={selectedCard.color} onChange={(event) => updateCard(selectedCard.id, { color: event.target.value })} /><span>{selectedCard.color.toUpperCase()}</span></div></label>
            <label className="rs-switch"><input type="checkbox" checked={selectedCard.compare} onChange={(event) => updateCard(selectedCard.id, { compare: event.target.checked })} /><span>Exibir série de comparação quando disponível</span></label>
            <h4>Filtro local do card</h4>
            <div className="rs-editor-grid">
              <label>Campo<select value={selectedCard.filterField} onChange={(event) => updateCard(selectedCard.id, { filterField: event.target.value })}><option value="">Nenhum</option>{studioSourceMap[selectedCard.source]?.dimensions.map((dimension) => <option value={dimension.key} key={dimension.key}>{dimension.label}</option>)}</select></label>
              <label>Contém<input value={selectedCard.filterValue} disabled={!selectedCard.filterField} onChange={(event) => updateCard(selectedCard.id, { filterValue: event.target.value })} placeholder="Ex.: PIX, João, Aberto…" /></label>
            </div>
            <h4>Comparativo entre relatórios</h4>
            <label>Segunda fonte<select value={selectedCard.blendSource} onChange={(event) => { const source = studioSourceMap[event.target.value]; updateCard(selectedCard.id, { blendSource: event.target.value, blendMetric: source?.metrics[0]?.key ?? '' }); }}><option value="">Não combinar</option>{studioSources.filter((source) => source.id !== selectedCard.source).map((source) => <option key={source.id} value={source.id}>{source.group} · {source.title}</option>)}</select></label>
            {selectedCard.blendSource ? <div className="rs-editor-grid"><label>Métrica B<select value={selectedCard.blendMetric} onChange={(event) => updateCard(selectedCard.id, { blendMetric: event.target.value })}>{studioSourceMap[selectedCard.blendSource]?.metrics.map((metric) => <option value={metric.key} key={metric.key}>{metric.label}</option>)}</select></label><label>Agregação B<select value={selectedCard.blendAggregation} onChange={(event) => updateCard(selectedCard.id, { blendAggregation: event.target.value as Agg })}>{(Object.keys(aggLabels) as Agg[]).map((agg) => <option key={agg} value={agg}>{aggLabels[agg]}</option>)}</select></label></div> : null}
            <p className="rs-editor-note">Clique em uma categoria para criar um filtro cruzado. Cards que possuam a mesma dimensão respondem juntos. Arraste os cards no canvas para reorganizar.</p>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
