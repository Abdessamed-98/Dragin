
import React, { DragEvent, useState, useEffect } from 'react';
import { LayoutGrid, Settings, Info, Eraser, Plus, Power, Trash2, Minus, Store, Download, Loader2, AlertCircle, HardDrive, X } from 'lucide-react';
import { ALL_TOOLS } from '../data/tools';
import { REGISTRY_MAP, formatSize, ON_DEMAND_TOOL_IDS } from '../data/toolRegistry';
import { ToolId, InstallProgress } from '../types';

interface ToolsGalleryProps {
    activeToolIds: ToolId[];
    installedToolIds: ToolId[];
    installProgress: Record<string, InstallProgress>;
    onClose?: () => void;
    onDragStart: (toolId: ToolId) => void;
    onDragEnd?: () => void;
    onToolUninstall?: (toolId: ToolId) => void;
    onClearData?: () => void;
    onAddTool: (toolId: ToolId) => void;
    onInstallTool: (toolId: ToolId) => void;
    onUninstallTool: (toolId: ToolId) => void;
    isDockEnabled: boolean;
    onToggleDock: () => void;
    // Dock → Gallery removal overlay
    onDockToolDragActive?: (callback: (data: { toolId: string }) => void) => void;
    onDockToolDragEnd?: (callback: () => void) => void;
}

type Tab = 'tools' | 'library' | 'settings' | 'about';

export const ToolsGallery: React.FC<ToolsGalleryProps> = ({
    activeToolIds,
    installedToolIds,
    installProgress,
    onDragStart,
    onDragEnd,
    onClearData,
    onAddTool,
    onInstallTool,
    onUninstallTool,
    onToolUninstall,
    isDockEnabled,
    onToggleDock,
    onDockToolDragActive,
    onDockToolDragEnd,
}) => {

    const [activeTab, setActiveTab] = useState<Tab>('tools');

    // --- Dock → Gallery Removal Overlay State ---
    const [dockDragToolId, setDockDragToolId] = useState<string | null>(null);

    useEffect(() => {
        if (!onDockToolDragActive || !onDockToolDragEnd) return;

        onDockToolDragActive((data) => {
            setDockDragToolId(data.toolId);
        });

        onDockToolDragEnd(() => {
            setDockDragToolId(null);
        });
    }, [onDockToolDragActive, onDockToolDragEnd]);

    // Only show tools that are NOT currently in the dock
    const availableTools = ALL_TOOLS.filter(t => !activeToolIds.includes(t.id));

    // Find the tool being dragged from dock for display
    const draggedTool = dockDragToolId ? ALL_TOOLS.find(t => t.id === dockDragToolId) : null;

    const handleDragStart = (e: DragEvent, toolId: ToolId) => {
        e.dataTransfer.setData('application/x-smart-tool-install', toolId);
        e.dataTransfer.effectAllowed = 'copy';

        // Notify main process for cross-window drag coordination
        onDragStart(toolId);
    };

    const handleDragEnd = () => {
        onDragEnd?.();
    };

    return (
        <div className="w-full h-screen bg-slate-900 text-slate-200 overflow-hidden flex flex-col relative">

            {/* === REMOVAL OVERLAY: Shows when a tool is being dragged FROM the dock === */}
            {dockDragToolId && (
                <div className="absolute inset-0 z-[100] bg-red-950/80 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-200">
                    <div className="relative">
                        <div className="absolute inset-0 bg-red-500 blur-3xl opacity-30 animate-pulse" />
                        <div className="w-28 h-28 rounded-3xl border-2 border-dashed border-red-400/60 flex items-center justify-center bg-red-900/30 backdrop-blur-sm relative">
                            <Trash2 className="w-12 h-12 text-red-400" />
                        </div>
                    </div>
                    <h2 className="text-xl font-bold text-red-200 mt-6">افلت هنا لحذف الأداة</h2>
                    {draggedTool && (
                        <p className="text-red-400/80 text-sm mt-2">{draggedTool.title}</p>
                    )}
                </div>
            )}

            {/* Main Content Area (Sidebar + Content) */}
            <div className="flex flex-1 overflow-hidden">

                {/* Sidebar */}
                <div className="w-48 bg-slate-950 border-r border-white/5 p-4 flex flex-col gap-2 shrink-0">
                    <div className="mb-4 px-2">
                        <span className="text-xs font-bold tracking-wider text-slate-500">CONTROL CENTER</span>
                    </div>
                    <button
                        onClick={() => setActiveTab('tools')}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'tools' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                    >
                        <LayoutGrid className="w-4 h-4" />
                        الادوات
                    </button>
                    <button
                        onClick={() => setActiveTab('library')}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'library' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                    >
                        <Store className="w-4 h-4" />
                        المتجر
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'settings' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                    >
                        <Settings className="w-4 h-4" />
                        الإعدادات
                    </button>
                    <button
                        onClick={() => setActiveTab('about')}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === 'about' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                    >
                        <Info className="w-4 h-4" />
                        حول
                    </button>
                </div>

                {/* Content Panel */}
                <div className="flex-1 bg-slate-900 overflow-y-auto p-8">

                    {/* TAB: TOOLS */}
                    {activeTab === 'tools' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">

                            {/* Section 1: Installed tools (in dock) */}
                            <div>
                                <div className="mb-4">
                                    <h2 className="text-xl font-bold text-white">الأدوات المثبتة</h2>
                                    <p className="text-slate-400 text-xs mt-1">الأدوات الموجودة حالياً في الشريط الجانبي</p>
                                </div>

                                {activeToolIds.length === 0 ? (
                                    <div className="p-8 border-2 border-dashed border-slate-700 rounded-xl flex flex-col items-center justify-center text-slate-500 bg-slate-800/20">
                                        <span className="text-sm">لا توجد أدوات مثبتة</span>
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
                                                    className="group relative flex flex-col items-center justify-center gap-3 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20"
                                                    title={tool.description}
                                                >
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onToolUninstall?.(tool.id);
                                                        }}
                                                        className="absolute top-2 left-2 p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white transition-all hover:scale-110 border border-red-500/20 hover:border-transparent z-10"
                                                        title="إزالة من الشريط"
                                                    >
                                                        <Minus className="w-4 h-4" />
                                                    </button>
                                                    <div className={`
                                                        w-10 h-10 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center
                                                        shadow-inner
                                                    `}>
                                                        <Icon className={`w-5 h-5 text-${tool.colorClass}-400`} />
                                                    </div>
                                                    <div className="text-center">
                                                        <div className="text-xs font-bold text-slate-300">{tool.title}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Divider */}
                            <div className="border-t border-white/5" />

                            {/* Section 2: Add tools */}
                            <div>
                                <div className="mb-4">
                                    <h2 className="text-xl font-bold text-white">مكتبة الأدوات</h2>
                                    <p className="text-slate-400 text-xs mt-1">اضغط على (+) أو اسحب الأداة لتثبيتها</p>
                                </div>

                                {availableTools.length === 0 ? (
                                    <div className="p-8 border-2 border-dashed border-slate-700 rounded-xl flex flex-col items-center justify-center text-slate-500 bg-slate-800/20">
                                        <span className="text-sm">جميع الأدوات مثبتة بالفعل</span>
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
                                                    draggable={isInstalled}
                                                    onDragStart={isInstalled ? (e) => handleDragStart(e, tool.id) : undefined}
                                                    onDragEnd={isInstalled ? handleDragEnd : undefined}
                                                    className={`
                                                        group relative flex flex-col items-center justify-center gap-3 p-4 rounded-xl
                                                        transition-all
                                                        ${isInstalled
                                                            ? 'bg-slate-800/40 border border-white/5 hover:bg-slate-700/50 hover:border-white/10 cursor-grab active:cursor-grabbing'
                                                            : 'bg-slate-800/20 border border-white/5 cursor-default'
                                                        }
                                                    `}
                                                    title={tool.description}
                                                >
                                                    {/* Action button: (+) for installed, download for not installed */}
                                                    {isInstalled ? (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onAddTool(tool.id);
                                                            }}
                                                            className="absolute top-2 left-2 p-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500 text-indigo-300 hover:text-white transition-all hover:scale-110 border border-indigo-500/20 hover:border-transparent z-10"
                                                            title="إضافة للشريط"
                                                        >
                                                            <Plus className="w-4 h-4" />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (!isInstalling) onInstallTool(tool.id);
                                                            }}
                                                            disabled={isInstalling}
                                                            className={`absolute top-2 left-2 p-1.5 rounded-lg transition-all border z-10 ${
                                                                isInstalling
                                                                    ? 'bg-slate-700/50 text-slate-500 border-slate-600 cursor-wait'
                                                                    : isError
                                                                        ? 'bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border-red-500/20 hover:border-transparent hover:scale-110'
                                                                        : 'bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white border-emerald-500/20 hover:border-transparent hover:scale-110'
                                                            }`}
                                                            title={isError ? 'إعادة المحاولة' : `تحميل (${formatSize(manifest?.totalSizeBytes || 0)})`}
                                                        >
                                                            {isInstalling ? (
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                            ) : isError ? (
                                                                <AlertCircle className="w-4 h-4" />
                                                            ) : (
                                                                <Download className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                    )}

                                                    <div className={`
                                                        w-10 h-10 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center
                                                        shadow-inner transition-transform duration-200
                                                        ${isInstalled ? 'group-hover:scale-110' : ''}
                                                    `}>
                                                        <Icon className={`w-5 h-5 text-${tool.colorClass}-400 ${!isInstalled && !isInstalling ? 'opacity-50' : ''}`} />
                                                    </div>
                                                    <div className="text-center">
                                                        <div className={`text-xs font-bold ${isInstalled ? 'text-slate-300 group-hover:text-white' : 'text-slate-500'}`}>{tool.title}</div>
                                                        {/* Size label for not-installed tools */}
                                                        {!isInstalled && !isInstalling && manifest && manifest.totalSizeBytes > 0 && (
                                                            <div className="text-[10px] text-slate-600 mt-0.5">{formatSize(manifest.totalSizeBytes)}</div>
                                                        )}
                                                        {/* Progress bar when installing */}
                                                        {isInstalling && progress && (
                                                            <div className="w-full mt-1.5">
                                                                <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-emerald-500 transition-all duration-300 rounded-full" style={{ width: `${progress.progress}%` }} />
                                                                </div>
                                                            </div>
                                                        )}
                                                        {/* Error message */}
                                                        {isError && progress?.error && (
                                                            <div className="text-[10px] text-red-400 mt-0.5 truncate max-w-[120px]">{progress.error}</div>
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
                            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center shadow-2xl mb-6 border border-white/5">
                                <Store className="w-9 h-9 text-slate-400" />
                            </div>
                            <h2 className="text-2xl font-bold text-white">المتجر</h2>
                            <p className="text-slate-400 text-sm mt-2">قريباً...</p>
                        </div>
                    )}

                    {/* TAB: SETTINGS */}
                    {activeTab === 'settings' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-4">
                            <div>
                                <h2 className="text-xl font-bold text-white">إعدادات النظام</h2>
                                <p className="text-slate-400 text-xs mt-1">تحكم في البيانات والخيارات العامة</p>
                            </div>

                            {/* Enable/Disable Toggle */}
                            <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4">
                                <div className="flex items-start gap-4">
                                    <div className={`p-3 rounded-full ${isDockEnabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                        <Power className="w-5 h-5" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-bold text-slate-200">حالة الشريط الجانبي</h3>
                                        <p className="text-xs text-slate-400 mt-1 mb-3">
                                            تفعيل أو تعطيل ظهور الشريط الجانبي عند اقتراب الماوس من حافة الشاشة.
                                        </p>
                                        <button
                                            onClick={onToggleDock}
                                            className={`px-4 py-2 text-xs font-bold rounded-lg border transition-colors ${isDockEnabled
                                                ? 'bg-green-900/40 hover:bg-green-900/60 text-green-200 border-green-500/20'
                                                : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border-slate-600'
                                                }`}
                                        >
                                            {isDockEnabled ? 'مفعل (نشط)' : 'معطل'}
                                        </button>
                                    </div>
                                </div>
                            </div>



                            {/* Storage — On-demand tools only (default tools ship with app, can't be removed) */}
                            {(() => {
                                const installedTools = ALL_TOOLS.filter(t => installedToolIds.includes(t.id) && ON_DEMAND_TOOL_IDS.includes(t.id));
                                const totalSize = installedTools.reduce((sum, t) => sum + (REGISTRY_MAP[t.id]?.totalSizeBytes || 0), 0);
                                return installedTools.length > 0 ? (
                                    <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4">
                                        <div className="flex items-start gap-4">
                                            <div className="p-3 rounded-full bg-indigo-500/10 text-indigo-400">
                                                <HardDrive className="w-5 h-5" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between mb-1">
                                                    <h3 className="text-sm font-bold text-slate-200">الأدوات المثبتة</h3>
                                                    {totalSize > 0 && <span className="text-[10px] text-slate-500">{formatSize(totalSize)} مستخدم</span>}
                                                </div>
                                                <p className="text-xs text-slate-400 mb-3">
                                                    إزالة أداة سيحذف ملفاتها ويوفر مساحة تخزين.
                                                </p>
                                                <div className="space-y-2">
                                                    {installedTools.map(tool => {
                                                        const Icon = tool.icon;
                                                        const manifest = REGISTRY_MAP[tool.id];
                                                        const size = manifest?.totalSizeBytes || 0;
                                                        return (
                                                            <div key={tool.id} className="flex items-center gap-3 px-3 py-2 bg-slate-900/40 border border-white/5 rounded-lg">
                                                                <Icon className={`w-4 h-4 text-${tool.colorClass}-400 shrink-0`} />
                                                                <span className="text-xs font-medium text-slate-300 flex-1">{tool.title}</span>
                                                                {size > 0 && <span className="text-[10px] text-slate-500 shrink-0">{formatSize(size)}</span>}
                                                                <button
                                                                    onClick={() => {
                                                                        if (confirm(`هل تريد إزالة "${tool.title}"؟`)) {
                                                                            onUninstallTool(tool.id);
                                                                        }
                                                                    }}
                                                                    className="p-1 rounded-md bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white transition-all border border-red-500/20 hover:border-transparent shrink-0"
                                                                    title="إزالة الأداة"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : null;
                            })()}

                            {/* Clear Data */}
                            <div className="bg-slate-800/30 border border-white/5 rounded-xl p-4">
                                <div className="flex items-start gap-4">
                                    <div className="p-3 rounded-full bg-red-500/10 text-red-400">
                                        <Eraser className="w-5 h-5" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-bold text-slate-200">مسح الملفات الحالية</h3>
                                        <p className="text-xs text-slate-400 mt-1 mb-3">
                                            سيقوم هذا الإجراء بحذف جميع الملفات والجلسات الحالية من الشريط الجانبي.
                                        </p>
                                        <button
                                            onClick={() => {
                                                if (confirm('هل أنت متأكد من حذف جميع الملفات الحالية؟')) {
                                                    if (onClearData) onClearData();
                                                }
                                            }}
                                            className="px-4 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-200 text-xs font-bold rounded-lg border border-red-500/20 transition-colors"
                                        >
                                            تنظيف الذاكرة الآن
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: ABOUT */}
                    {activeTab === 'about' && (
                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">

                            {/* App info */}
                            <div className="flex flex-col items-center text-center">
                                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-indigo-500/20 mb-6">
                                    <span className="text-3xl font-bold text-white">OS</span>
                                </div>
                                <h2 className="text-2xl font-bold text-white">Mock OS Utilities</h2>
                                <p className="text-slate-400 text-sm mt-2 max-w-xs mx-auto">
                                    مجموعة أدوات ذكية تعمل محلياً لتحسين الإنتاجية.
                                </p>
                                <div className="mt-4 flex flex-col gap-2 items-center">
                                    <span className="text-xs text-slate-500 bg-slate-900/50 px-3 py-1 rounded-full border border-white/5">Version 1.0.0 (Beta)</span>
                                    <span className="text-xs text-slate-600">Built with React & Tailwind</span>
                                </div>
                            </div>

                            {/* Divider */}
                            <div className="border-t border-white/5" />

                            {/* Open source licenses */}
                            <div>
                                <h3 className="text-sm font-bold text-slate-300 mb-3">مكتبات مفتوحة المصدر</h3>
                                <div className="space-y-2">
                                    {[
                                        { name: 'rembg (BiRefNet / ISNet)', purpose: 'حذف الخلفية', license: 'Apache 2.0 / MIT', url: 'https://github.com/danielgatis/rembg' },
                                        { name: 'EasyOCR', purpose: 'استخراج النص', license: 'Apache 2.0', url: 'https://github.com/JaidedAI/EasyOCR' },
                                        { name: 'vtracer', purpose: 'تحويل لـ Vector', license: 'MIT', url: 'https://github.com/visioncortex/vtracer' },
                                        { name: 'PyMuPDF (fitz)', purpose: 'أدوات PDF', license: 'AGPL-3.0', url: 'https://github.com/pymupdf/PyMuPDF' },
                                        { name: 'FFmpeg', purpose: 'تحويل الفيديو والصوت', license: 'LGPL-2.1+', url: 'https://ffmpeg.org' },
                                        { name: 'Real-ESRGAN (ncnn-vulkan)', purpose: 'رفع دقة الصور', license: 'BSD-3-Clause', url: 'https://github.com/xinntao/Real-ESRGAN' },
                                        { name: 'pdf2docx', purpose: 'تحويل PDF إلى Word', license: 'GPL-3.0', url: 'https://github.com/ArtifexSoftware/pdf2docx' },
                                        { name: 'python-pptx', purpose: 'تحويل PDF إلى PowerPoint', license: 'MIT', url: 'https://github.com/scanny/python-pptx' },
                                    ].map((lib) => (
                                        <div key={lib.name} className="flex items-center justify-between px-4 py-3 bg-slate-800/30 border border-white/5 rounded-xl">
                                            <div>
                                                <div className="text-xs font-bold text-slate-300">{lib.name}</div>
                                                <div className="text-xs text-slate-500 mt-0.5">{lib.purpose}</div>
                                            </div>
                                            <span className="text-xs text-slate-400 bg-slate-900/60 px-2 py-1 rounded-md border border-white/5 shrink-0">{lib.license}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                        </div>
                    )}

                </div>
            </div>


        </div>
    );
};
