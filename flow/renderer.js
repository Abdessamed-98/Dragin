const { ipcRenderer, webUtils } = require('electron');

const container = document.getElementById('drop-container');
const previewGrid = document.getElementById('preview-grid');
const initialContent = document.getElementById('initial-content');

let currentFiles = [];

// 1. منع السلوك الافتراضي للمتصفح (ضروري لعمل السحب والإفلات)
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    window.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

// 2. إظهار النافذة بصرياً عند مرور ملف فوقها
window.addEventListener('dragover', () => {
    if (currentFiles.length === 0) {
        container.classList.add('visible');
        container.classList.add('drag-over');
    }
});

window.addEventListener('dragleave', () => {
    container.classList.remove('drag-over');
});

// 3. معالجة الملفات عند إفلاتها داخل النافذة (Drop In)
window.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files);

    if (files.length > 0) {
        // تحويل الملفات لمسارات حقيقية في النظام
        currentFiles = files.map(f => webUtils.getPathForFile(f));

        // إبلاغ العملية الرئيسية بوجود ملفات (لمنع الإخفاء التلقائي)
        ipcRenderer.send('update-file-status', true);

        // عرض المعاينة
        renderPreviews(files);
    }
});

// 4. دالة إنشاء عرض الملفات والصور
function renderPreviews(files) {
    initialContent.style.display = 'none';
    previewGrid.style.display = 'grid';
    previewGrid.innerHTML = ''; // تنظيف العرض القديم

    container.classList.add('expanded');
    container.classList.add('visible');

    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';

        // إذا كان الملف صورة، نقوم بعمل Preview لها
        if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file); // إنشاء رابط مؤقت للصورة
            item.appendChild(img);
        } else {
            // أيقونة افتراضية للملفات الأخرى
            const icon = document.createElement('div');
            icon.className = 'file-icon';
            icon.innerText = "📄";
            item.appendChild(icon);
        }

        // عرض اسم الملف
        const name = document.createElement('div');
        name.className = 'file-name';
        name.innerText = file.name;
        item.appendChild(name);

        // عرض حجم الملف (NEW)
        const sizeInfo = document.createElement('div');
        sizeInfo.className = 'file-size';
        sizeInfo.style.fontSize = "9px";
        sizeInfo.style.opacity = "0.7";
        sizeInfo.style.marginTop = "2px";
        sizeInfo.innerText = formatBytes(file.size);
        item.appendChild(sizeInfo);

        previewGrid.appendChild(item);
    });
}

function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 5. السحب للخارج (Drag Out) مع التحقق من الحركة (Smart Drag)
let isDragPending = false;
let startX = 0;
let startY = 0;
const DRAG_THRESHOLD = 10; // بكسل

container.addEventListener('mousedown', (e) => {
    if (currentFiles.length > 0) {
        isDragPending = true;
        startX = e.clientX;
        startY = e.clientY;
    }
});

window.addEventListener('mousemove', (e) => {
    if (isDragPending) {
        const deltaX = Math.abs(e.clientX - startX);
        const deltaY = Math.abs(e.clientY - startY);

        // إذا تحرك الماوس مسافة كافية، نبدأ السحب
        if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
            isDragPending = false; // لمنع التكرار
            ipcRenderer.send('start-drag', currentFiles);

            // بعد بدء السحب بنجاح، ننتظر قليلاً ثم نفرغ النافذة
            setTimeout(() => {
                resetUI();
                ipcRenderer.send('update-file-status', false);
            }, 1000);
        }
    }
});

window.addEventListener('mouseup', () => {
    isDragPending = false;
});

// 6. إعادة تعيين الواجهة للحالة الافتراضية
function resetUI() {
    currentFiles = [];
    previewGrid.innerHTML = '';
    previewGrid.style.display = 'none';
    initialContent.style.display = 'flex';
    container.classList.remove('expanded');
    container.classList.remove('visible');
    container.classList.remove('drag-over');
}

// استقبال أمر إعادة التعيين من العملية الرئيسية (Main Process)
ipcRenderer.on('reset-ui', () => {
    // لا نمسح الواجهة إذا كان المستخدم قد وضع ملفات بالفعل
    if (currentFiles.length === 0) {
        resetUI();
    }
});