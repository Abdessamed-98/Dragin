import React, { useState } from 'react';
import { DockApp } from './components/DockApp';
import { GalleryApp } from './components/GalleryApp';
import { I18nProvider } from './i18n/I18nContext';
import { ThemeProvider } from './theme/ThemeContext';

const App: React.FC = () => {
    const [view] = useState<'dock' | 'gallery'>(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('window') === 'gallery' ? 'gallery' : 'dock';
    });

    return (
        <ThemeProvider>
            <I18nProvider>
                {view === 'gallery' ? <GalleryApp /> : <DockApp />}
            </I18nProvider>
        </ThemeProvider>
    );
};

export default App;
