
import React, { useState, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import Papa from 'papaparse';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis, Legend 
} from 'recharts';
import { 
  Search, Upload, Download, Target, PieChart as PieIcon, 
  TrendingUp, AlertCircle, CheckCircle, ArrowRight, Filter, 
  LayoutDashboard, Table as TableIcon, Info, HelpCircle
} from 'lucide-react';

// --- CONFIGURATION / SEO RULES (Synced with Python) ---
const INTENT_MAP = {
  informational: ['how', 'what', 'why', 'guide', 'tutorial', 'symptoms', 'meaning', 'definition', 'examples', 'tips', 'learn', 'resource', 'benefits'],
  commercial: ['price', 'cost', 'buy', 'best', 'top', 'vs', 'review', 'alternative', 'discount', 'cheap', 'comparison', 'pricing', 'order'],
  navigational: ['login', 'website', 'contact', 'address', 'official', 'support', 'signin', 'account', 'portal'],
  local: ['near me', 'nearby', 'in ', 'at ', 'open now', 'directions', 'location', 'store', 'shop']
};

const COLUMN_ALIASES: Record<string, string[]> = {
  query: ['query', 'top queries', 'search term', 'keywords'],
  clicks: ['clicks', 'click count'],
  impressions: ['impressions', 'impr', 'view count'],
  ctr: ['ctr', 'click through rate', 'click-through rate'],
  position: ['position', 'average position', 'avg position', 'rank']
};

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981'];

// --- TYPES ---
interface GSCRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  intent: string;
  score: number;
  tags: string[];
  action: string;
  contentType: string;
  priority: 'High' | 'Medium' | 'Low';
  clusterLabel: string;
}

const App: React.FC = () => {
  const [data, setData] = useState<GSCRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'opportunities' | 'clusters'>('overview');
  const [searchTerm, setSearchTerm] = useState('');

  // --- DATA PROCESSING LOGIC ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        processGSCData(results.data);
      }
    });
  };

  const processGSCData = (rawRows: any[]) => {
    // 1. Column Normalization
    const mapping: Record<string, string> = {};
    if (rawRows.length === 0) return;
    
    const headers = Object.keys(rawRows[0]);
    headers.forEach(header => {
      const lower = header.toLowerCase();
      for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.includes(lower)) {
          mapping[header] = key;
          break;
        }
      }
    });

    // 2. Cleaning & Basic Stats
    const cleaned: any[] = rawRows.map(row => {
      const normalizedRow: any = {};
      Object.entries(row).forEach(([k, v]) => {
        if (mapping[k]) normalizedRow[mapping[k]] = v;
      });
      
      // Safe CTR handling
      if (typeof normalizedRow.ctr === 'string' && normalizedRow.ctr.includes('%')) {
        normalizedRow.ctr = parseFloat(normalizedRow.ctr.replace('%', '')) / 100;
      } else if (normalizedRow.ctr > 1) {
        normalizedRow.ctr = normalizedRow.ctr / 100;
      }
      
      return normalizedRow;
    }).filter(r => r.query && typeof r.query === 'string' && r.query.length > 1);

    // 3. Adaptive Thresholds
    const impressionsList = cleaned.map(r => r.impressions).sort((a, b) => a - b);
    const ctrList = cleaned.map(r => r.ctr).sort((a, b) => a - b);
    const hiImprThresh = impressionsList[Math.floor(impressionsList.length * 0.75)] || 0;
    const loCtrThresh = ctrList[Math.floor(ctrList.length * 0.25)] || 0;

    // 4. Intent & Scoring
    const processed = cleaned.map(row => {
      const query = row.query.toLowerCase();
      let intent = 'other';
      for (const [key, mods] of Object.entries(INTENT_MAP)) {
        if (mods.some(m => query.includes(m))) {
          intent = key;
          break;
        }
      }

      const tags: string[] = [];
      let score = 0;
      if (row.position >= 4 && row.position <= 20) { tags.push('near_page_1'); score += 40; }
      if (row.impressions >= hiImprThresh && row.ctr <= loCtrThresh) { tags.push('low_ctr_win'); score += 30; }
      if (intent === 'commercial') { tags.push('commercial_intent'); score += 20; }
      if (intent === 'informational' && row.position > 10) { tags.push('info_gap'); score += 10; }

      let action = 'Monitor';
      let contentType = 'refresh_existing';
      let priority: 'High' | 'Medium' | 'Low' = 'Low';

      if (tags.includes('near_page_1') && tags.includes('low_ctr_win')) {
        action = 'Optimize Snippets (Title/Meta)';
        contentType = 'snippet_optimization';
        priority = 'High';
      } else if (tags.includes('near_page_1')) {
        action = 'Boost Content & Internal Links';
        priority = 'High';
      } else if (tags.includes('info_gap')) {
        action = 'Create New Guide/Page';
        contentType = 'new_page';
        priority = 'Medium';
      }

      // Simple keyword clustering: first two words
      const clusterLabel = query.split(' ').slice(0, 2).join(' ');

      return {
        ...row,
        intent,
        score: Math.min(score, 100),
        tags,
        action,
        contentType,
        priority,
        clusterLabel
      };
    });

    setData(processed.sort((a, b) => b.score - a.score));
    setIsProcessing(false);
  };

  // --- ANALYTICS CALCULATIONS ---
  const stats = useMemo(() => {
    if (data.length === 0) return null;
    return {
      totalQueries: data.length,
      totalClicks: data.reduce((acc, r) => acc + (r.clicks || 0), 0),
      totalImpr: data.reduce((acc, r) => acc + (r.impressions || 0), 0),
      avgPos: data.reduce((acc, r) => acc + (r.position || 0), 0) / data.length
    };
  }, [data]);

  const intentData = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(r => counts[r.intent] = (counts[r.intent] || 0) + 1);
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [data]);

  const clusterData = useMemo(() => {
    const clusters: Record<string, { name: string, impressions: number, queries: number }> = {};
    data.forEach(r => {
      if (!clusters[r.clusterLabel]) clusters[r.clusterLabel] = { name: r.clusterLabel, impressions: 0, queries: 0 };
      clusters[r.clusterLabel].impressions += r.impressions;
      clusters[r.clusterLabel].queries += 1;
    });
    return Object.values(clusters).sort((a, b) => b.impressions - a.impressions).slice(0, 10);
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter(r => r.query.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [data, searchTerm]);

  // --- RENDERING ---
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-12">
      {/* Header */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-2 rounded-lg text-white">
                <Target size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">GSC Intelligence</h1>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">SEO Dashboard</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-full cursor-pointer hover:bg-indigo-100 transition-colors border border-indigo-100">
                <Upload size={18} />
                <span className="text-sm font-semibold">Upload GSC CSV</span>
                <input type="file" className="hidden" accept=".csv" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 border-2 border-dashed border-slate-300 rounded-3xl bg-white shadow-sm">
            <div className="bg-slate-50 p-6 rounded-full mb-6">
              <Upload className="text-slate-400" size={48} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800">No Data Loaded</h2>
            <p className="text-slate-500 mt-2 text-center max-w-md">
              Drag and drop your Google Search Console "Queries" export here to begin clustering and analysis.
            </p>
            <div className="mt-8 flex gap-4 text-xs font-mono text-slate-400">
              <span className="px-2 py-1 bg-slate-100 rounded">Query</span>
              <span className="px-2 py-1 bg-slate-100 rounded">Clicks</span>
              <span className="px-2 py-1 bg-slate-100 rounded">Impressions</span>
              <span className="px-2 py-1 bg-slate-100 rounded">CTR</span>
              <span className="px-2 py-1 bg-slate-100 rounded">Position</span>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: 'Total Queries', value: stats?.totalQueries.toLocaleString(), icon: Search, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'Organic Clicks', value: stats?.totalClicks.toLocaleString(), icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Total Impressions', value: stats?.totalImpr.toLocaleString(), icon: PieIcon, color: 'text-amber-600', bg: 'bg-amber-50' },
                { label: 'Avg. Position', value: stats?.avgPos.toFixed(1), icon: Target, color: 'text-indigo-600', bg: 'bg-indigo-50' }
              ].map((s, i) => (
                <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
                  <div className={`${s.bg} p-3 rounded-xl`}>
                    <s.icon className={s.color} size={24} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">{s.label}</p>
                    <p className="text-2xl font-bold text-slate-900">{s.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200">
              {[
                { id: 'overview', label: 'Market Overview', icon: LayoutDashboard },
                { id: 'opportunities', label: 'Actionable Opportunities', icon: AlertCircle },
                { id: 'clusters', label: 'Topic Clusters', icon: TableIcon }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all border-b-2 -mb-[1px] ${
                    activeTab === tab.id 
                    ? 'border-indigo-600 text-indigo-600' 
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <tab.icon size={18} />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                  <div className="flex justify-between items-start mb-6">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <PieIcon className="text-slate-400" size={20} /> Search Intent Profile
                    </h3>
                    <HelpCircle className="text-slate-300 cursor-pointer" size={18} />
                  </div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={intentData}
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {intentData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend verticalAlign="bottom" height={36}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                  <div className="flex justify-between items-start mb-6">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <TrendingUp className="text-slate-400" size={20} /> The SEO Sweet Spot
                    </h3>
                    <p className="text-xs text-slate-400 italic">Position vs CTR</p>
                  </div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" dataKey="position" name="Position" unit="" reversed domain={[0, 40]} label={{ value: 'Position', position: 'insideBottom', offset: -10 }} />
                        <YAxis type="number" dataKey="ctr" name="CTR" unit="%" label={{ value: 'CTR%', angle: -90, position: 'insideLeft' }} />
                        <ZAxis type="number" dataKey="impressions" range={[60, 400]} name="Impressions" />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                        <Scatter name="Queries" data={data.slice(0, 100)} fill="#6366f1" opacity={0.6} />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
                  <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                    <Filter className="text-slate-400" size={20} /> Top Topic Clusters by Visibility
                  </h3>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={clusterData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12, fontWeight: 500 }} />
                        <Tooltip cursor={{fill: 'transparent'}} />
                        <Bar dataKey="impressions" fill="#818cf8" radius={[0, 4, 4, 0]} barSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Opportunities Tab */}
            {activeTab === 'opportunities' && (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-white p-4 rounded-xl border border-slate-200">
                  <div className="relative w-full max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                      type="text" 
                      placeholder="Search keywords..." 
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <span className="text-xs font-medium bg-slate-100 px-3 py-1 rounded-full text-slate-500 border border-slate-200">
                      Showing {filteredData.length} of {data.length} queries
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 font-bold text-slate-600">Query & Action</th>
                        <th className="px-6 py-4 font-bold text-slate-600">Priority</th>
                        <th className="px-6 py-4 font-bold text-slate-600 text-right">Impr.</th>
                        <th className="px-6 py-4 font-bold text-slate-600 text-right">Pos.</th>
                        <th className="px-6 py-4 font-bold text-slate-600 text-right">CTR</th>
                        <th className="px-6 py-4 font-bold text-slate-600">Intent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredData.slice(0, 50).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="font-bold text-slate-900 mb-1 flex items-center gap-2">
                              {row.query}
                              <ArrowRight size={14} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <div className="text-xs text-indigo-600 font-semibold flex items-center gap-1">
                              <CheckCircle size={12} /> {row.action}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                              row.priority === 'High' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                              row.priority === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                              'bg-slate-50 text-slate-600 border-slate-100'
                            }`}>
                              {row.priority}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-medium text-slate-600">{row.impressions.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right">
                            <span className={`font-mono ${row.position <= 10 ? 'text-emerald-600 font-bold' : 'text-slate-500'}`}>
                              {row.position.toFixed(1)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-mono text-slate-500">{(row.ctr * 100).toFixed(1)}%</td>
                          <td className="px-6 py-4">
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded-full uppercase font-bold tracking-tight">
                              {row.intent}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredData.length > 50 && (
                    <div className="p-4 text-center bg-slate-50 border-t border-slate-200">
                      <button className="text-indigo-600 font-bold text-sm hover:underline">
                        View {filteredData.length - 50} more results
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Clusters Tab */}
            {activeTab === 'clusters' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clusterData.map((cluster, i) => (
                  <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-200 transition-all">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h4 className="font-bold text-slate-900 capitalize">{cluster.name}</h4>
                        <p className="text-xs text-slate-400 font-medium uppercase">{cluster.queries} Related Queries</p>
                      </div>
                      <div className="bg-indigo-50 text-indigo-700 p-2 rounded-lg">
                        <TableIcon size={18} />
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Total Visibility</span>
                        <span className="font-bold">{cluster.impressions.toLocaleString()} Impr</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-indigo-500 h-full rounded-full" 
                          style={{ width: `${(cluster.impressions / (stats?.totalImpr || 1)) * 100 * 5}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Loading Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="font-bold text-slate-900">Normalizing & Clustering Data...</p>
          <p className="text-sm text-slate-500">This usually takes a few seconds.</p>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
