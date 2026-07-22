/**
 * PDF on the shell — the multi-subtool editor (merge/organize/compress/convert/
 * searchable/toImages/fromImages + page-reorder overlay) is large and self-
 * contained, so rather than re-express it as a descriptor we wrap the existing
 * PdfTool as a shell Body with the shell header hidden (it renders its own).
 * This brings pdf onto the shell frame + lets the old ToolWidget path retire,
 * with zero risk to pdf's internals. It reads the session via its own ingest.
 */
import React from 'react';
import { FileText } from 'lucide-react';
import { PdfTool } from '../tools/PdfTool';
import { toolAccepts } from '../../state/toolCompat';
import type { ShellTool, FocusBodyProps } from './shellTools';

const PdfBody: React.FC<FocusBodyProps> = ({ onClose }) => (
    <div className="flex-1 relative min-h-0">
        <PdfTool onClose={onClose} active={true} />
    </div>
);

export const pdfTool: ShellTool = {
    id: 'pdf', kind: 'focus', hideHeader: true, accent: 'red', Icon: FileText, titleKey: 'pdf.headerTitle',
    accept: f => toolAccepts('pdf', f), inputAccept: 'application/pdf,image/*',
    emptyTitleKey: 'pdf.headerTitle', Body: PdfBody,
};
