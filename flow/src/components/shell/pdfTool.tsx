/**
 * PDF on the shell — the multi-subtool editor (merge/organize/compress/convert/
 * searchable/toImages/fromImages + page-reorder overlay) is large and self-
 * contained, so rather than re-express it as a descriptor we wrap the existing
 * PdfTool as a shell Body with the shell header hidden (it renders its own).
 * This brings pdf onto the shell frame + lets the old ToolWidget path retire,
 * with zero risk to pdf's internals. It reads the session via its own ingest.
 */
import React, { Suspense } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toolAccepts } from '../../state/toolCompat';
import type { ShellTool, FocusBodyProps } from './shellTools';

// Lazy: PdfTool is the largest component in the app and only needed when the
// pdf panel opens — keep it out of the startup bundle.
const PdfTool = React.lazy(() => import('../tools/PdfTool').then(m => ({ default: m.PdfTool })));

const PdfBody: React.FC<FocusBodyProps> = ({ onClose }) => (
    <div className="flex-1 relative min-h-0">
        <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-6 h-6 text-red-400 animate-spin" /></div>}>
            <PdfTool onClose={onClose} active={true} />
        </Suspense>
    </div>
);

export const pdfTool: ShellTool = {
    id: 'pdf', kind: 'focus', hideHeader: true, accent: 'red', Icon: FileText, titleKey: 'pdf.headerTitle',
    accept: f => toolAccepts('pdf', f), inputAccept: 'application/pdf,image/*',
    emptyTitleKey: 'pdf.headerTitle', Body: PdfBody,
};
