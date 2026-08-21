import { useTranslation } from 'react-i18next';
import {
  PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
  ResponsiveContainer,
} from 'recharts';

const COLORS = [
  '#4c8dff', '#2f68cc', '#78a9ff', '#35b978', '#20935d',
  '#62d39a', '#e5484d', '#f26467', '#315faf', '#c9363c',
];

interface ChartDataItem {
  name: string;
  value: number;
}

interface ChartRendererProps {
  args: {
    chartType?: 'pie' | 'bar' | 'line';
    title?: string;
    data?: ChartDataItem[];
  };
}

export function ChartRenderer({ args }: ChartRendererProps) {
  const { t } = useTranslation();
  const { chartType = 'pie', title, data = [] } = args;

  if (data.length === 0) {
    return (
      <div className="my-2 rounded-lg border border-border bg-surface-950 p-3 text-xs text-text-secondary">
        {t('chart.noData')}
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-border bg-surface-950 p-3 text-text-primary shadow-lg">
      {title && (
        <div className="mb-3 text-sm font-semibold text-text-primary">{title}</div>
      )}
      <ResponsiveContainer width="100%" height={240}>
        {chartType === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
              labelLine={false}
              fontSize={11}
            >
              {data.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #444', borderRadius: 6, fontSize: 12 }}
              itemStyle={{ color: '#e5e5e5' }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        ) : chartType === 'bar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="name" tick={{ fill: '#aaa', fontSize: 11 }} />
            <YAxis tick={{ fill: '#aaa', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #444', borderRadius: 6, fontSize: 12 }}
              itemStyle={{ color: '#e5e5e5' }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="name" tick={{ fill: '#aaa', fontSize: 11 }} />
            <YAxis tick={{ fill: '#aaa', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #444', borderRadius: 6, fontSize: 12 }}
              itemStyle={{ color: '#e5e5e5' }}
            />
            <Line type="monotone" dataKey="value" stroke="#4c8dff" strokeWidth={2} dot={{ fill: '#4c8dff' }} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
