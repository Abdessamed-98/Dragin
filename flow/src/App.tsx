import React, { useState } from 'react';
import { DockApp } from './components/DockApp';
import { GalleryApp } from './components/GalleryApp';

const App: React.FC = () => {
    const [view] = useState<'dock' | 'gallery'>(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('window') === 'gallery' ? 'gallery' : 'dock';
    });

    if (view === 'gallery') return <GalleryApp />;
    return <DockApp />;
};

export default App;
