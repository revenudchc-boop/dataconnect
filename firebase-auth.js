import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc
} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyA1FUASqUvJLgQuNlDvbeVr8Cz8wONPopM",
    authDomain: "dchc-invoice.firebaseapp.com",
    projectId: "dchc-invoice",
    storageBucket: "dchc-invoice.firebasestorage.app",
    messagingSenderId: "379598072082",
    appId: "1:379598072082:web:72683888466ab66978abcb",
    measurementId: "G-839Q28SKV5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// تطبيق ثانوي لإنشاء حسابات جديدة من لوحة المدير دون تسجيل خروج المدير
const secondaryApp = initializeApp(firebaseConfig, 'AdminCreator');
const secondaryAuth = getAuth(secondaryApp);

// تحويل اسم المستخدم إلى بريد داخلي ثابت متوافق مع Firebase
async function usernameToAuthEmail(username) {
    const clean = String(username || '').trim().toLowerCase();
    if (/^[a-z0-9](?:[a-z0-9_-]|\.[a-z0-9_-])*$/.test(clean) && clean.length <= 55) {
        return `n_${clean}@dchc.app`;
    }
    const bytes = new TextEncoder().encode(clean);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex.length <= 55) {
        return `u_${hex}@dchc.app`;
    }
    const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
    const hashHex = Array.from(new Uint8Array(hashBuf)).slice(0, 16)
        .map(b => b.toString(16).padStart(2, '0')).join('');
    return `h_${hashHex}@dchc.app`;
}

function extractTaxKeys(userObj) {
    const keys = new Set();
    if (userObj.taxNumber) keys.add(String(userObj.taxNumber).trim().toLowerCase());
    if (userObj.contractCustomerId) keys.add(String(userObj.contractCustomerId).trim().toLowerCase());
    if (Array.isArray(userObj.customerIds)) {
        userObj.customerIds.forEach(id => {
            if (id && String(id).trim()) keys.add(String(id).trim().toLowerCase());
        });
    }
    return Array.from(keys).filter(Boolean);
}

async function syncTaxRegistry(keys) {
    for (const key of keys) {
        await setDoc(doc(db, 'taxRegistry', key), { registered: true }, { merge: true });
    }
}

window.FB = {
    async login(username, password) {
        const authEmail = await usernameToAuthEmail(username);
        const cred = await signInWithEmailAndPassword(auth, authEmail, password);
        const uid = cred.user.uid;

        let snap;
        try {
            snap = await getDoc(doc(db, 'users', uid));
        } catch (err) {
            await signOut(auth);
            throw new Error('الحساب غير نشط أو غير مصرح له بالدخول');
        }

        if (!snap.exists()) {
            await signOut(auth);
            throw new Error('ملف بيانات المستخدم غير موجود');
        }

        const profile = { id: uid, ...snap.data() };
        if (profile.status !== 'active') {
            await signOut(auth);
            throw new Error('هذا الحساب غير نشط، تواصل مع الإدارة');
        }

        const now = new Date().toISOString();
        await updateDoc(doc(db, 'users', uid), { lastLogin: now }).catch(() => {});
        profile.lastLogin = now;
        return profile;
    },

    waitForInitialUser() {
        return new Promise((resolve) => {
            const unsub = onAuthStateChanged(auth, async (fbUser) => {
                unsub();
                if (!fbUser) return resolve(null);
                try {
                    const snap = await getDoc(doc(db, 'users', fbUser.uid));
                    if (!snap.exists() || snap.data().status !== 'active') {
                        await signOut(auth);
                        return resolve(null);
                    }
                    resolve({ id: fbUser.uid, ...snap.data() });
                } catch {
                    await signOut(auth);
                    resolve(null);
                }
            });
        });
    },

    async logout() {
        await signOut(auth);
    },

    async getIdToken(forceRefresh = false) {
        if (!auth.currentUser) return null;
        return await auth.currentUser.getIdToken(forceRefresh);
    },

    async checkGuestTax(taxNumber) {
        const key = String(taxNumber || '').trim().toLowerCase();
        if (!key) return false;
        const snap = await getDoc(doc(db, 'taxRegistry', key));
        return snap.exists();
    },

    async changeOwnPassword(currentPassword, newPassword) {
        const fbUser = auth.currentUser;
        if (!fbUser || !fbUser.email) throw new Error('يجب تسجيل الدخول أولاً');
        if (!newPassword || newPassword.length < 6) {
            throw new Error('كلمة المرور يجب أن لا تقل عن 6 أحرف');
        }
        const credential = EmailAuthProvider.credential(fbUser.email, currentPassword);
        await reauthenticateWithCredential(fbUser, credential);
        await updatePassword(fbUser, newPassword);
    },

    async listUsers() {
        const snapshot = await getDocs(collection(db, 'users'));
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async createUser(userData) {
        const authEmail = await usernameToAuthEmail(userData.username);
        let newUid;
        try {
            const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, userData.password);
            newUid = cred.user.uid;
        } finally {
            await signOut(secondaryAuth).catch(() => {});
        }

        const profile = {
            username: userData.username.trim(),
            email: (userData.email || '').trim(),
            additionalEmails: Array.isArray(userData.additionalEmails) ? userData.additionalEmails : [],
            taxNumber: (userData.taxNumber || '').trim(),
            contractCustomerId: (userData.contractCustomerId || '').trim(),
            customerIds: Array.isArray(userData.customerIds) ? userData.customerIds : [],
            userType: userData.userType || 'customer',
            status: userData.status || 'active',
            startDate: userData.startDate || null,
            createdAt: new Date().toISOString(),
            lastLogin: null
        };

        await setDoc(doc(db, 'users', newUid), profile);
        await syncTaxRegistry(extractTaxKeys(profile));
        return { id: newUid, ...profile };
    },

    async updateUser(userId, userData) {
        const updatePayload = {
            email: (userData.email || '').trim(),
            taxNumber: (userData.taxNumber || '').trim(),
            contractCustomerId: (userData.contractCustomerId || '').trim(),
            customerIds: Array.isArray(userData.customerIds) ? userData.customerIds : [],
            userType: userData.userType || 'customer',
            status: userData.status || 'active'
        };
        await updateDoc(doc(db, 'users', userId), updatePayload);
        await syncTaxRegistry(extractTaxKeys(updatePayload));
    },

    async deleteUserDoc(userId) {
        await deleteDoc(doc(db, 'users', userId));
    },

    async migrateBatch(usersArray, defaultPassword) {
        const results = [];
        for (const u of usersArray) {
            try {
                const pwd = u.password || defaultPassword;
                if (!pwd || pwd.length < 6) {
                    results.push({ username: u.username, status: 'skipped (password < 6)' });
                    continue;
                }
                await this.createUser({
                    username: u.username,
                    email: u.email || '',
                    additionalEmails: Array.isArray(u.additionalEmails) ? u.additionalEmails.filter(Boolean) : [],
                    taxNumber: u.taxNumber || '',
                    contractCustomerId: u.contractCustomerId || '',
                    customerIds: Array.isArray(u.customerIds) ? u.customerIds : [],
                    userType: u.userType || (u.username === 'admin' ? 'admin' : u.username === 'accountant' ? 'accountant' : 'customer'),
                    status: u.status || 'active',
                    password: pwd
                });
                results.push({ username: u.username, status: 'ok' });
            } catch (err) {
                results.push({ username: u.username, status: err.code || err.message });
            }
        }
        console.table(results);
        return results;
    }
};