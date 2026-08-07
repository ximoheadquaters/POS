import fs from 'node:fs';

const path = 'apps/mobile/src/screens/reports-workspace.tsx';
let src = fs.readFileSync(path, 'utf8');

src = src.replace(
  /\r?\nimport \{ saveReportExport, type ReportExportFormat \} from '@\/lib\/save-report-export';/,
  '',
);

src = src.replace(
  /\r?\nasync function exportMetricToPdf\([\s\S]*?\r?\n\}\r?\n\r?\nasync function exportMetricToExcel\([\s\S]*?\r?\n\}\r?\n/,
  '\n',
);

src = src.replace(/\r?\n  const \[exporting, setExporting\] = useState<'pdf' \| 'xlsx' \| null>\(null\);/, '');
src = src.replace(/\r?\n  const handleExport = async \(format: 'pdf' \| 'xlsx'\) => \{[\s\S]*?\r?\n  \};/, '');

src = src.replace(
  /\r?\n        <View className="flex-row items-center gap-2">\r?\n          <Pressable\r?\n            disabled=\{Boolean\(exporting\)\}[\s\S]*?\r?\n        <\/View>\r?\n      <\/View>\r?\n\r?\n      \{\/\* Main Metric Title Banner \*\/\}/,
  '\n      </View>\n\n      {/* Main Metric Title Banner */}',
);

src = src.replace(
  '  const { currentUser } = useSession();',
  '  const { currentUser, session, loading: sessionLoading } = useSession();',
);

src = src.replace(
  /\r?\n  const \[exportVisible, setExportVisible\] = useState\(false\);\r?\n  const \[exporting, setExporting\] = useState<ReportExportFormat \| null>\(null\);\r?\n  const \[exportError, setExportError\] = useState\(''\);\r?\n/,
  '\n',
);

src = src.replace(
  `  const query = useQuery({
    queryKey: ['reports-workspace', period, branch?.id, range.from, range.to],
    queryFn: () =>
      api<ReportsWorkspace>(
        \`/reports/workspace?from=\${encodeURIComponent(range.from)}&to=\${encodeURIComponent(
          range.to,
        )}\${branch?.id ? \`&branchId=\${branch.id}\` : ''}\`,
      ),
  });`,
  `  const query = useQuery({
    queryKey: ['reports-workspace', period, branch?.id, range.from, range.to, session?.user?.id],
    enabled: !sessionLoading && Boolean(session?.access_token),
    queryFn: () =>
      api<ReportsWorkspace>(
        \`/reports/workspace?from=\${encodeURIComponent(range.from)}&to=\${encodeURIComponent(
          range.to,
        )}\${branch?.id ? \`&branchId=\${branch.id}\` : ''}\`,
      ),
  });`,
);

src = src.replace(
  `  const productPerformanceQuery = useQuery({
    queryKey: ['reports-product-performance', period, branch?.id, range.from, range.to],
    enabled: section === 'products',`,
  `  const productPerformanceQuery = useQuery({
    queryKey: ['reports-product-performance', period, branch?.id, range.from, range.to, session?.user?.id],
    enabled: !sessionLoading && Boolean(session?.access_token) && section === 'products',`,
);

src = src.replace(/\r?\n  const exportReport = async \(format: ReportExportFormat\) => \{[\s\S]*?\r?\n  \};\r?\n/, '\n');

src = src.replace(
  /action=\{\r?\n          <Pressable\r?\n            accessibilityRole="button"\r?\n            accessibilityLabel="Export reports"[\s\S]*?<\/Pressable>\r?\n        \}/,
  'action={null}',
);

src = src.replace(
  /\r?\n      \{\/\* Export Modal \*\/\}\r?\n      <Modal[\s\S]*?<\/Modal>\r?\n    <\/Screen>/,
  '\n    </Screen>',
);

const leftovers = [
  'saveReportExport',
  'pdf-lib',
  'xlsx-js-style',
  'report-export',
  'exportReport',
  'exportVisible',
  'exportMetric',
  'ReportExportFormat',
].filter((hit) => src.includes(hit));

if (leftovers.length) {
  console.error('FAILED_CLEANUP', leftovers.join(','));
  process.exit(1);
}

fs.writeFileSync(path, src);
console.log('CLEANED', path, src.length);
