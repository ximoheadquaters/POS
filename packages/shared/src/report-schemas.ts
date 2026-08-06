import { z } from 'zod';

export const reportQueryFilterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  branchId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  cashierId: z.string().uuid().optional(),
  paymentMethod: z.string().optional(),
});

export type ReportQueryFilterInput = z.infer<typeof reportQueryFilterSchema>;

export interface SummaryCardContract {
  cardId: string;
  label: string;
  value: number | string | null;
  formattedValue: string;
  comparisonValue?: number | null;
  comparisonLabel?: string;
  trend?: 'up' | 'down' | 'neutral';
  drillDownAvailable: boolean;
  exportAvailable: boolean;
  formulaDescription: string;
  isSensitive?: boolean;
}

export interface ReportSeriesContract {
  seriesId: string;
  label: string;
  chartType: 'line' | 'bar' | 'donut' | 'radial';
  xAxis: string;
  yAxis: string;
  data: Array<{ x: string | number; y: number; label?: string; color?: string }>;
}

export interface ReportDetailRowContract {
  id: string;
  title: string;
  sku?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  baseQuantity?: number;
  baseUnit?: string;
  value: string;
  subValue?: string;
  statusTag?: string;
  statusTone?: 'green' | 'amber' | 'red' | 'blue' | 'slate';
  note?: string;
  netCost?: string | null;
  grossProfit?: string | null;
}

export interface CanonicalReportResponse {
  reportId: string;
  title: string;
  description: string;
  generatedAt: string;
  timezone: string;
  currency: string;
  appliedFilters: {
    from: string;
    to: string;
    branchId: string | null;
    branchName?: string;
  };
  summaryCards: SummaryCardContract[];
  series: ReportSeriesContract[];
  rows: ReportDetailRowContract[];
  pagination: {
    totalRows: number;
    page: number;
    pageSize: number;
  };
  warnings: string[];
}
