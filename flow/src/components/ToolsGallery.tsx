
import React, { useState, useEffect } from 'react';
import { LayoutGrid, Settings, Info, Eraser, Plus, Power, Minus, Store, Download, Loader2, AlertCircle, X, FolderOpen, Globe, Eye, Sun, Moon, PanelLeft, PanelRight, PanelTop, PanelBottom, ChevronDown } from 'lucide-react';
import { useLocalizedTools } from '../i18n/useLocalizedTools';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';
import { REGISTRY_MAP, formatSize, ON_DEMAND_TOOL_IDS } from '../data/toolRegistry';
import { ToolId, InstallProgress } from '../types';

interface ToolsGalleryProps {
    activeToolIds: ToolId[];
    installedToolIds: ToolId[];
    installProgress: Record<string, InstallProgress>;
    onClose?: () => void;
    onToolUninstall?: (toolId: ToolId) => void;
    onClearData?: () => void;
    onOpenLogs?: () => void;
    onAddTool: (toolId: ToolId) => void;
    onInstallTool: (toolId: ToolId) => void;
    onCancelInstall: (toolId: ToolId) => void;
    onUninstallTool: (toolId: ToolId) => void;
    isDockEnabled: boolean;
    onToggleDock: () => void;
}

type Tab = 'tools' | 'library' | 'settings' | 'about';

// ── Graphite settings primitives ──────────────────────────────────────────
const SettingSwitch: React.FC<{ on: boolean; onClick: () => void }> = ({ on, onClick }) => (
    <button
        onClick={onClick}
        role="switch"
        aria-checked={on}
        className={`relative w-[44px] h-[26px] rounded-full transition-colors duration-200 shrink-0 ${on ? 'bg-[var(--green)]' : 'bg-[var(--surface-3)]'}`}
    >
        <span className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200 ${on ? 'translate-x-[18px]' : ''}`} />
    </button>
);

const SettingSeg: React.FC<{ options: { value: string; label: React.ReactNode }[]; value: string; onChange: (v: string) => void }> = ({ options, value, onChange }) => (
    <div className="inline-flex bg-[var(--surface-3)] rounded-[10px] p-0.5 gap-0.5 shrink-0">
        {options.map(o => (
            <button
                key={o.value}
                onClick={() => onChange(o.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-xs font-semibold transition-colors ${value === o.value ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--e1)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}
            >
                {o.label}
            </button>
        ))}
    </div>
);

// Styled native dropdown (for choices whose labels are full phrases).
const SettingSelect: React.FC<{ options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }> = ({ options, value, onChange }) => (
    <div className="relative shrink-0">
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="appearance-none bg-[var(--surface-3)] text-[var(--text)] text-xs font-semibold rounded-[10px] pl-3 pr-8 py-1.5 cursor-pointer border border-transparent hover:bg-[var(--surface-2)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-2)]" />
    </div>
);

// One settings row: colored icon square + title/subtitle + a control on the right.
const SettingRow: React.FC<{ icon: React.ReactNode; iconBg: string; title: string; subtitle?: string; control: React.ReactNode; last?: boolean }> = ({ icon, iconBg, title, subtitle, control, last }) => (
    <div className={`flex items-center gap-3.5 px-4 py-3 ${last ? '' : 'border-b border-[var(--separator)]'}`}>
        <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 text-white" style={{ background: iconBg }}>{icon}</div>
        <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[var(--text)]">{title}</div>
            {subtitle && <div className="text-xs text-[var(--text-2)] mt-0.5 leading-snug">{subtitle}</div>}
        </div>
        <div className="shrink-0">{control}</div>
    </div>
);

export const ToolsGallery: React.FC<ToolsGalleryProps> = ({
    activeToolIds,
    installedToolIds,
    installProgress,
    onClearData,
    onOpenLogs,
    onAddTool,
    onInstallTool,
    onCancelInstall,
    onUninstallTool,
    onToolUninstall,
    isDockEnabled,
    onToggleDock,
}) => {

    const { t, lang, setLang } = useI18n();
    const { theme, setTheme } = useTheme();
    const ALL_TOOLS = useLocalizedTools();

    const [activeTab, setActiveTab] = useState<Tab>('tools');

    // --- Debug "sensing zones" overlay toggle (synced to the dock window) ---
    const [debugZones, setDebugZones] = useState(false);
    const [dockEdge, setDockEdge] = useState<string>('right');
    useEffect(() => {
        window.electron?.getSetting?.('debugZones').then((v: any) => setDebugZones(!!v));
        window.electron?.getSetting?.('dockEdge').then((v: any) => { if (v) setDockEdge(v); });
        window.electron?.onSettingChange?.(({ key, value }) => {
            if (key === 'debugZones') setDebugZones(!!value);
            if (key === 'dockEdge' && value) setDockEdge(value);
        });
    }, []);
    const toggleDebugZones = () => {
        const next = !debugZones;
        setDebugZones(next);
        window.electron?.setSetting?.('debugZones', next);
    };
    const changeDockEdge = (v: string) => {
        setDockEdge(v);
        window.electron?.setSetting?.('dockEdge', v);
    };

    // --- Output saving (post-drop) ---
    const [saveMode, setSaveMode] = useState<'ask' | 'beside' | 'folder'>('folder');
    const [openAfterSave, setOpenAfterSave] = useState(true); // default on
    const [outputFolder, setOutputFolder] = useState<string>('');
    useEffect(() => {
        window.electron?.getSetting?.('saveMode').then((v: any) => { if (v) setSaveMode(v); });
        window.electron?.getSetting?.('openFolderAfterSave').then((v: any) => setOpenAfterSave(v !== false));
        window.electron?.getSetting?.('outputFolder').then((v: any) => setOutputFolder(v || ''));
    }, []);
    const changeSaveMode = (v: string) => { setSaveMode(v as any); window.electron?.setSetting?.('saveMode', v); };
    const toggleOpenAfter = () => { const n = !openAfterSave; setOpenAfterSave(n); window.electron?.setSetting?.('openFolderAfterSave', n); };
    const pickOutputFolder = async () => {
        const dir = await (window as any).electron?.pickOutputFolder?.();
        if (dir) setOutputFolder(dir);
    };

    // Only show tools that are NOT currently in the dock
    const availableTools = ALL_TOOLS.filter(t => !activeToolIds.includes(t.id));

    return (
        <div className="w-full h-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden flex flex-col relative">

            {/* Main Content Area (Sidebar + Content) */}
            <div className="flex flex-1 overflow-hidden">

                {/* Sidebar */}
                <div className="w-48 bg-[var(--bg)] border-r border-[var(--separator)] p-4 flex flex-col gap-2 shrink-0">
                    <div className="mb-4 px-2">
                        <span className="text-xs font-bold tracking-wider text-[var(--text-3)]">CONTROL CENTER</span>
                    </div>
                    <button
                        onClick={() => setActiveTab('tools')}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'tools' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'}`}
                    >
                        <LayoutGrid className="w-4 h-4" />
                        {t('gallery.sidebar.tools')}
                    </button>
                    <button
                        onClick={() => setActiveTab('library')}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'library' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'}`}
                    >
                        <Store className="w-4 h-4" />
                        {t('gallery.sidebar.store')}
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'settings' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'}`}
                    >
                        <Settings className="w-4 h-4" />
                        {t('gallery.sidebar.settings')}
                    </button>
                    <button
                        onClick={() => setActiveTab('about')}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'about' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'}`}
                    >
                        <Info className="w-4 h-4" />
                        {t('gallery.sidebar.about')}
                    </button>
                </div>

                {/* Content Panel */}
                <div className="flex-1 bg-[var(--bg)] overflow-y-auto p-8">

                    {/* TAB: TOOLS */}
                    {activeTab === 'tools' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">

                            {/* Section 1: Installed tools (in dock) */}
                            <div>
                                <div className="mb-4">
                                    <h2 className="text-xl font-bold text-[var(--text)]">{t('gallery.tools.installed')}</h2>
                                    <p className="text-[var(--text-2)] text-xs mt-1">{t('gallery.tools.installedDesc')}</p>
                                </div>

                                {activeToolIds.length === 0 ? (
                                    <div className="p-8 border-2 border-dashed border-[var(--border)] rounded-xl flex flex-col items-center justify-center text-[var(--text-3)] bg-[var(--surface-2)]">
                                        <span className="text-sm">{t('gallery.tools.noTools')}</span>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
                                        {activeToolIds.map((id) => {
                                            const tool = ALL_TOOLS.find(t => t.id === id);
                                            if (!tool) return null;
                                            const Icon = tool.icon;
                                            return (
                                                <div
                                                    key={tool.id}
                                                    className="group relative flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl h-[120px] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--e1)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[var(--e2)]"
                                                    title={tool.description}
                                                >
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onToolUninstall?.(tool.id);
                                                        }}
                                                        className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] opacity-0 group-hover:opacity-100 hover:bg-[var(--red)] hover:text-white hover:border-transparent transition-all z-10 shadow-[var(--e1)]"
                                                        title={t('gallery.tools.removeFromDock')}
                                                    >
                                                        <Minus className="w-3.5 h-3.5" />
                                                    </button>
                                                    <div className={`w-12 h-12 rounded-[14px] flex items-center justify-center bg-${tool.colorClass}-500/10`}>
                                                        <Icon className={`w-6 h-6 text-${tool.colorClass}-400`} />
                                                    </div>
                                                    <div className="text-[13px] font-semibold text-[var(--text)] text-center leading-tight">{tool.title}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Divider */}
                            <div className="border-t border-[var(--separator)]" />

                            {/* Section 2: Add tools */}
                            <div>
                                <div className="mb-4">
                                    <h2 className="text-xl font-bold text-[var(--text)]">{t('gallery.tools.library')}</h2>
                                    <p className="text-[var(--text-2)] text-xs mt-1">{t('gallery.tools.libraryDesc')}</p>
                                </div>

                                {availableTools.length === 0 ? (
                                    <div className="p-8 border-2 border-dashed border-[var(--border)] rounded-xl flex flex-col items-center justify-center text-[var(--text-3)] bg-[var(--surface-2)]">
                                        <span className="text-sm">{t('gallery.tools.allInstalled')}</span>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
                                        {availableTools.map((tool) => {
                                            const Icon = tool.icon;
                                            const isInstalled = installedToolIds.includes(tool.id);
                                            const manifest = REGISTRY_MAP[tool.id];
                                            const progress = installProgress[tool.id];
                                            const isInstalling = progress?.status === 'installing';
                                            const isError = progress?.status === 'error';

                                            return (
                                                <div
                                                    key={tool.id}
                                                    className="group relative flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl h-[120px] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--e1)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[var(--e2)]"
                                                    title={tool.description}
                                                >
                                                    {/* Corner action: + (add/install), download, cancel, or retry */}
                                                    {isInstalled ? (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onAddTool(tool.id); }}
                                                            className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-all z-10 shadow-[var(--e1)]"
                                                            title={t('gallery.tools.addToDock')}
                                                        >
                                                            <Plus className="w-3.5 h-3.5" />
                                                        </button>
                                                    ) : isInstalling ? (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onCancelInstall(tool.id); }}
                                                            className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-3)] hover:bg-[var(--red)] hover:text-white hover:border-transparent transition-all z-10 group/cancel"
                                                            title={t('gallery.tools.cancelDownload')}
                                                        >
                                                            <Loader2 className="w-3.5 h-3.5 animate-spin group-hover/cancel:hidden" />
                                                            <X className="w-3.5 h-3.5 hidden group-hover/cancel:block" />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onInstallTool(tool.id); }}
                                                            className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center transition-all z-10 shadow-[var(--e1)] ${
                                                                isError
                                                                    ? 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--red)] hover:bg-[var(--red)] hover:text-white hover:border-transparent'
                                                                    : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white'
                                                            }`}
                                                            title={isError ? t('gallery.tools.retry') : t('gallery.tools.download') + ` (${formatSize(manifest?.totalSizeBytes || 0)})`}
                                                        >
                                                            {isError ? <AlertCircle className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                                                        </button>
                                                    )}

                                                    <div className={`w-12 h-12 rounded-[14px] flex items-center justify-center bg-${tool.colorClass}-500/10`}>
                                                        <Icon className={`w-6 h-6 text-${tool.colorClass}-400`} />
                                                    </div>
                                                    <div className="text-[13px] font-semibold text-[var(--text)] text-center leading-tight">{tool.title}</div>
                                                    {/* Fixed-height status slot — bar/size/error never shift the icon+name */}
                                                    <div className="h-[16px] w-full flex items-center justify-center px-1">
                                                        {isInstalling && progress ? (
                                                            <div className="w-full h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden">
                                                                <div className="h-full bg-[var(--accent)] transition-all duration-300 rounded-full" style={{ width: `${progress.progress}%` }} />
                                                            </div>
                                                        ) : isError && progress?.error ? (
                                                            <span className="text-[10px] text-[var(--red)] truncate">{progress.error}</span>
                                                        ) : manifest && manifest.totalSizeBytes > 0 ? (
                                                            <span className="text-[10px] text-[var(--text-3)]">{formatSize(manifest.totalSizeBytes)}</span>
                                                        ) : (
                                                            <span className="text-[10px] text-[var(--text-3)]">{t('gallery.tools.bundled')}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                        </div>
                    )}

                    {/* TAB: LIBRARY */}
                    {activeTab === 'library' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 h-full flex flex-col items-center justify-center text-center">
                            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[var(--surface-3)] to-[var(--surface)] flex items-center justify-center shadow-2xl mb-6 border border-[var(--separator)]">
                                <Store className="w-9 h-9 text-[var(--text-2)]" />
                            </div>
                            <h2 className="text-2xl font-bold text-[var(--text)]">{t('gallery.store.title')}</h2>
                            <p className="text-[var(--text-2)] text-sm mt-2">{t('gallery.store.comingSoon')}</p>
                        </div>
                    )}

                    {/* TAB: SETTINGS */}
                    {activeTab === 'settings' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl space-y-7">
                            <div>
                                <h2 className="text-2xl font-bold text-[var(--text)] tracking-tight">{t('gallery.settings.title')}</h2>
                                <p className="text-[var(--text-2)] text-sm mt-1">{t('gallery.settings.desc')}</p>
                            </div>

                            {/* GENERAL */}
                            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--e1)] overflow-hidden">
                                <SettingRow
                                    icon={<Power className="w-[18px] h-[18px]" />}
                                    iconBg="var(--green)"
                                    title={t('gallery.settings.dockStatus')}
                                    subtitle={t('gallery.settings.dockStatusDesc')}
                                    control={<SettingSwitch on={isDockEnabled} onClick={onToggleDock} />}
                                />
                                <SettingRow
                                    icon={<PanelRight className="w-[18px] h-[18px]" />}
                                    iconBg="var(--accent)"
                                    title={t('gallery.settings.dockPosition')}
                                    subtitle={t('gallery.settings.dockPositionDesc')}
                                    control={<SettingSeg
                                        value={dockEdge}
                                        onChange={changeDockEdge}
                                        options={[
                                            { value: 'left', label: <PanelLeft className="w-3.5 h-3.5" /> },
                                            { value: 'right', label: <PanelRight className="w-3.5 h-3.5" /> },
                                            { value: 'top', label: <PanelTop className="w-3.5 h-3.5" /> },
                                            { value: 'bottom', label: <PanelBottom className="w-3.5 h-3.5" /> },
                                        ]}
                                    />}
                                />
                                <SettingRow
                                    icon={theme === 'dark' ? <Moon className="w-[18px] h-[18px]" /> : <Sun className="w-[18px] h-[18px]" />}
                                    iconBg="var(--accent)"
                                    title="Appearance"
                                    subtitle="Light or dark dock & gallery"
                                    control={<SettingSeg
                                        value={theme}
                                        onChange={(v) => setTheme(v as 'light' | 'dark')}
                                        options={[
                                            { value: 'light', label: <><Sun className="w-3.5 h-3.5" /> Light</> },
                                            { value: 'dark', label: <><Moon className="w-3.5 h-3.5" /> Dark</> },
                                        ]}
                                    />}
                                />
                                <SettingRow
                                    last
                                    icon={<Globe className="w-[18px] h-[18px]" />}
                                    iconBg="#0a84ff"
                                    title={t('gallery.settings.language')}
                                    subtitle={t('gallery.settings.languageDesc')}
                                    control={<SettingSeg
                                        value={lang}
                                        onChange={(v) => setLang(v as 'ar' | 'en')}
                                        options={[
                                            { value: 'ar', label: 'العربية' },
                                            { value: 'en', label: 'English' },
                                        ]}
                                    />}
                                />
                            </div>

                            {/* SAVING — post-drop output handling */}
                            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--e1)] overflow-hidden">
                                <SettingRow
                                    icon={<Download className="w-[18px] h-[18px]" />}
                                    iconBg="var(--green)"
                                    title={t('gallery.settings.saveLocation')}
                                    subtitle={t('gallery.settings.saveLocationDesc')}
                                    control={<SettingSelect
                                        value={saveMode}
                                        onChange={changeSaveMode}
                                        options={[
                                            { value: 'ask', label: t('gallery.settings.saveAsk') },
                                            { value: 'beside', label: t('gallery.settings.saveBesideShort') },
                                            { value: 'folder', label: t('gallery.settings.saveFolder') },
                                        ]}
                                    />}
                                />
                                {saveMode === 'folder' && (
                                    <SettingRow
                                        icon={<FolderOpen className="w-[18px] h-[18px]" />}
                                        iconBg="var(--orange)"
                                        title={t('gallery.settings.outputFolder')}
                                        subtitle={outputFolder || 'Downloads'}
                                        control={<button
                                            onClick={pickOutputFolder}
                                            className="px-3 py-1.5 rounded-[10px] text-xs font-semibold bg-[var(--surface-3)] text-[var(--text)] hover:bg-[var(--surface-2)]"
                                        >{t('gallery.settings.change')}</button>}
                                    />
                                )}
                                <SettingRow
                                    last
                                    icon={<FolderOpen className="w-[18px] h-[18px]" />}
                                    iconBg="#0a84ff"
                                    title={t('gallery.settings.openAfterSave')}
                                    subtitle={t('gallery.settings.openAfterSaveDesc')}
                                    control={<SettingSwitch on={openAfterSave} onClick={toggleOpenAfter} />}
                                />
                            </div>

                            {/* STORAGE — on-demand tools only */}
                            {(() => {
                                const installedTools = ALL_TOOLS.filter(t => installedToolIds.includes(t.id) && ON_DEMAND_TOOL_IDS.includes(t.id));
                                const totalSize = installedTools.reduce((sum, t) => sum + (REGISTRY_MAP[t.id]?.totalSizeBytes || 0), 0);
                                if (installedTools.length === 0) return null;
                                return (
                                    <div>
                                        <div className="flex items-center justify-between px-1 mb-2">
                                            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">{t('gallery.settings.installedTools')}</span>
                                            {totalSize > 0 && <span className="text-[11px] text-[var(--text-3)]">{formatSize(totalSize)} {t('gallery.settings.used')}</span>}
                                        </div>
                                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--e1)] overflow-hidden">
                                            {installedTools.map((tool, i) => {
                                                const Icon = tool.icon;
                                                const manifest = REGISTRY_MAP[tool.id];
                                                const size = manifest?.totalSizeBytes || 0;
                                                return (
                                                    <div key={tool.id} className={`flex items-center gap-3.5 px-4 py-3 ${i === installedTools.length - 1 ? '' : 'border-b border-[var(--separator)]'}`}>
                                                        <div className={`w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-${tool.colorClass}-500/10`}>
                                                            <Icon className={`w-[18px] h-[18px] text-${tool.colorClass}-400`} />
                                                        </div>
                                                        <span className="text-sm font-medium text-[var(--text)] flex-1 min-w-0 truncate">{tool.title}</span>
                                                        {size > 0 && <span className="text-xs text-[var(--text-3)] shrink-0">{formatSize(size)}</span>}
                                                        <button
                                                            onClick={() => {
                                                                if (confirm(t('gallery.settings.confirmUninstall', { name: tool.title }))) {
                                                                    onUninstallTool(tool.id);
                                                                }
                                                            }}
                                                            className="w-7 h-7 rounded-full flex items-center justify-center bg-[var(--surface-2)] hover:bg-[var(--red)] text-[var(--text-2)] hover:text-white transition-colors shrink-0"
                                                            title={t('gallery.settings.uninstallTool')}
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* DATA & ADVANCED */}
                            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-[var(--e1)] overflow-hidden">
                                <SettingRow
                                    icon={<Eye className="w-[18px] h-[18px]" />}
                                    iconBg="var(--orange)"
                                    title="Sensing zones"
                                    subtitle="Show the dock's reveal & hit areas (debug)"
                                    control={<SettingSwitch on={debugZones} onClick={toggleDebugZones} />}
                                />
                                <SettingRow
                                    icon={<Eraser className="w-[18px] h-[18px]" />}
                                    iconBg="var(--red)"
                                    title={t('gallery.settings.clearFiles')}
                                    subtitle={t('gallery.settings.clearFilesDesc')}
                                    control={
                                        <button
                                            onClick={() => { if (confirm(t('gallery.settings.confirmClear'))) onClearData?.(); }}
                                            className="px-4 h-9 rounded-[10px] text-[13px] font-semibold bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--red)] transition-colors"
                                        >
                                            {t('gallery.settings.clearNow')}
                                        </button>
                                    }
                                />
                                <SettingRow
                                    last
                                    icon={<FolderOpen className="w-[18px] h-[18px]" />}
                                    iconBg="#8e8e93"
                                    title={t('gallery.settings.appLog')}
                                    subtitle={t('gallery.settings.appLogDesc')}
                                    control={
                                        <button
                                            onClick={() => onOpenLogs?.()}
                                            className="px-4 h-9 rounded-[10px] text-[13px] font-semibold bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] transition-colors"
                                        >
                                            {t('gallery.settings.openLog')}
                                        </button>
                                    }
                                />
                            </div>
                        </div>
                    )}

                    {/* TAB: ABOUT */}
                    {activeTab === 'about' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">

                            {/* App info */}
                            <div className="flex flex-col items-center text-center">
                                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-indigo-500/20 mb-6">
                                    <span className="text-3xl font-bold text-white">DF</span>
                                </div>
                                <h2 className="text-2xl font-bold text-[var(--text)]">Dragin Flow</h2>
                                <p className="text-[var(--text-2)] text-sm mt-2 max-w-xs mx-auto">
                                    {t('gallery.about.tagline')}
                                </p>
                                <span className="mt-4 text-xs text-[var(--text-3)] bg-[var(--surface-2)] px-3 py-1 rounded-full border border-[var(--separator)]">1.0.0 Beta</span>
                            </div>

                            {/* Divider */}
                            <div className="border-t border-[var(--separator)]" />

                            {/* Open source acknowledgements — compact inline list */}
                            <div className="text-center">
                                <h3 className="text-xs font-medium text-[var(--text-3)] mb-2">{t('gallery.about.openSource')}</h3>
                                <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
                                    {[
                                        'rembg', 'BiRefNet', 'ISNet', 'EasyOCR', 'vtracer',
                                        'PyMuPDF', 'FFmpeg', 'Real-ESRGAN', 'pdf2docx', 'python-pptx',
                                    ].join(' \u00B7 ')}
                                </p>
                            </div>

                        </div>
                    )}

                </div>
            </div>


        </div>
    );
};
