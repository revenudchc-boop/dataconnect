// sw.js - Service Worker للإشعارات الفورية

// هذا الحدث يحدث عندما يتم تثبيت Service Worker لأول مرة
self.addEventListener('install', function(event) {
    console.log('Service Worker تم تثبيته بنجاح');
    // نتخطى مرحلة الانتظار ونفعّل الـ Service Worker فوراً
    event.waitUntil(self.skipWaiting());
});

// هذا الحدث يحدث عندما يتم تنشيط Service Worker
self.addEventListener('activate', function(event) {
    console.log('Service Worker تم تفعيله');
    // نأخذ التحكم في جميع الصفحات المفتوحة فوراً
    event.waitUntil(self.clients.claim());
});

// ✅ هذه هي الوظيفة الأهم: استقبال الإشعار وعرضه
self.addEventListener('push', function(event) {
    console.log('📨 Push event received: ', event);
    
    let notificationData = {
        title: '📄 إشعار جديد',
        body: 'هناك تحديث في نظام الفواتير',
        icon: '/logo.png',  // ضع رابط صورة الشعار لديك
        badge: '/badge.png', // صورة صغيرة للشارة (اختياري)
        vibrate: [200, 100, 200], // اهتزاز للهواتف المحمولة
        tag: 'invoice-notification', // لمنع تكرار الإشعارات
        requireInteraction: true, // يبقى الإشعار حتى يتفاعل معه المستخدم
        data: {
            url: '/'  // الرابط الذي سيفتح عند الضغط على الإشعار
        }
    };

    // إذا كان هناك بيانات مرسلة مع الإشعار، نستخدمها
    if (event.data) {
        try {
            const payload = event.data.json();
            if (payload.title) notificationData.title = payload.title;
            if (payload.body) notificationData.body = payload.body;
            if (payload.url) notificationData.data.url = payload.url;
        } catch(e) {
            console.log('البيانات المرسلة ليست بصيغة JSON');
        }
    }

    // عرض الإشعار
    event.waitUntil(
        self.registration.showNotification(notificationData.title, {
            body: notificationData.body,
            icon: notificationData.icon,
            badge: notificationData.badge,
            vibrate: notificationData.vibrate,
            tag: notificationData.tag,
            requireInteraction: notificationData.requireInteraction,
            data: notificationData.data
        })
    );
});

// هذا الحدث يحدث عند الضغط على الإشعار
self.addEventListener('notificationclick', function(event) {
    console.log('🔔 تم الضغط على الإشعار', event);
    
    // إغلاق الإشعار
    event.notification.close();
    
    // فتح الرابط المخزن في الإشعار أو الصفحة الرئيسية
    const urlToOpen = event.notification.data?.url || '/';
    
    event.waitUntil(
        clients.matchAll({type: 'window', includeUncontrolled: true})
            .then(windowClients => {
                // إذا كان هناك نافذة مفتوحة بالفعل للموقع، نستخدمها
                for (let client of windowClients) {
                    if (client.url.includes(window.location.origin) && 'focus' in client) {
                        client.focus();
                        if (client.url !== urlToOpen) client.navigate(urlToOpen);
                        return;
                    }
                }
                // إذا لم يكن هناك نافذة مفتوحة، نفتح واحدة جديدة
                if (clients.openWindow) return clients.openWindow(urlToOpen);
            })
    );
});