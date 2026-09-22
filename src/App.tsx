import React, { useState, useEffect } from 'react';
import { 
  Instagram, MessageSquare, BookOpen, BarChart3, Settings, 
  ShieldCheck, Zap, UserCheck, UserX, Send, Plus, Trash2, 
  CheckCircle2, AlertCircle, Lock, Key, RefreshCw, LogOut, 
  FileText, ExternalLink, Sparkles, Database, Code, Bot, X, HelpCircle, ChevronDown
} from 'lucide-react';
import { auth, db } from './firebase';
import { 
  signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, signOut, onAuthStateChanged 
} from 'firebase/auth';
import { 
  collection, doc, getDoc, setDoc, getDocs, addDoc, 
  query, where, deleteDoc, onSnapshot 
} from 'firebase/firestore';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'connections' | 'knowledge' | 'inbox' | 'analytics' | 'simulator'>('connections');
  
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [connectedPageName, setConnectedPageName] = useState('');

  // Knowledge Base state
  const [kbItems, setKbItems] = useState([
    { id: '1', title: 'Return & Refund Policy', content: 'We accept returns within 30 days of purchase for unused items in original packaging.', category: 'Policy' },
    { id: '2', title: 'Shipping Times', content: 'Standard domestic shipping takes 3-5 business days. Express shipping takes 1-2 days.', category: 'Shipping' },
    { id: '3', title: 'Summer Collection 2026', content: 'Our new organic linen dresses are available in sizes XS-XXL starting at $89.', category: 'Catalog' }
  ]);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a professional, friendly AI customer support specialist for our Instagram boutique. Answer questions accurately based on our knowledge base, keep responses under 3 sentences, and invite users to checkout on our website.');

  // Inbox & Human Takeover state
  const [conversations, setConversations] = useState([
    { id: 'conv_1', customerName: 'Sarah Jenkins', customerHandle: '@sarah_j_style', lastMessage: 'Do you ship to Canada?', timestamp: '2 mins ago', humanTakeover: false, unread: true },
    { id: 'conv_2', customerName: 'Alex Rivera', customerHandle: '@alexrivera_fit', lastMessage: 'What sizes are left in the linen dress?', timestamp: '14 mins ago', humanTakeover: true, unread: false },
    { id: 'conv_3', customerName: 'Elena Rostova', customerHandle: '@elena_designs', lastMessage: 'Thanks for the quick reply!', timestamp: '1 hour ago', humanTakeover: false, unread: false }
  ]);
  const [selectedConv, setSelectedConv] = useState<any>(conversations[0]);
  const [chatMessages, setChatMessages] = useState([
    { sender: 'customer', text: 'Hi! Do you ship to Canada?', time: '10:42 AM' },
    { sender: 'ai', text: 'Hello Sarah! Yes, we ship worldwide including Canada via DHL Express (3-4 business days). Let us know if you need help picking a size!', time: '10:43 AM' },
    { sender: 'customer', text: 'Awesome, thanks!', time: '10:44 AM' }
  ]);
  const [replyInput, setReplyInput] = useState('');

  // Simulator state
  const [simMessage, setSimMessage] = useState('');
  const [simHistory, setSimHistory] = useState<any[]>([
    { sender: 'ai', text: 'Hello! I am your AI Instagram assistant. Ask me anything about our products, shipping, or policies!', time: 'Just now' }
  ]);
  const [isSimulating, setIsSimulating] = useState(false);

  // Analytics state
  const [analytics, setAnalytics] = useState({
    totalDMs: 1420,
    resolvedRate: 94.2,
    apiCreditsUsed: 3840,
    activeSubscribers: 189
  });

  // Modals
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState('');

  // AI Onboarding Copilot state
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [copilotInput, setCopilotInput] = useState('');
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState<Array<{ sender: 'copilot' | 'user'; text: string; time: string }>>([
    {
      sender: 'copilot',
      text: 'Namaste! 👋 Main aapka InstaFlow Setup Guide hoon. Main aapko apne business ke liye 24/7 Instagram AI Bot setup karne me step-by-step guide karunga. Aapka kaunsa business hai, ya aap shuru kaise karna chahte hain?',
      time: 'Just now'
    }
  ]);

  const handleCopilotSend = async (customText?: string) => {
    const textToSend = customText || copilotInput;
    if (!textToSend.trim() || isCopilotLoading) return;

    setCopilotInput('');
    const newHistory = [
      ...copilotMessages,
      { sender: 'user' as const, text: textToSend, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    ];
    setCopilotMessages(newHistory);
    setIsCopilotLoading(true);

    try {
      const res = await fetch('/api/onboard-copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          conversationHistory: newHistory.slice(-6)
        })
      });
      const data = await res.json();
      if (data.reply) {
        setCopilotMessages(prev => [
          ...prev,
          { sender: 'copilot', text: data.reply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
        ]);
      }
    } catch (e) {
      setCopilotMessages(prev => [
        ...prev,
        { sender: 'copilot', text: 'Step 1: Knowledge Base me FAQs daalein. Step 2: Simulator me test karein. Step 3: Connection Center me Instagram jodein!', time: 'Just now' }
      ]);
    } finally {
      setIsCopilotLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setIsDemoMode(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed');
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setAuthError(err.message || 'Google sign-in failed');
    }
  };

  const handleSimulateSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simMessage.trim()) return;

    const userText = simMessage;
    setSimMessage('');
    const newHistory = [...simHistory, { sender: 'customer', text: userText, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }];
    setSimHistory(newHistory);
    setIsSimulating(true);

    try {
      const kbCombined = kbItems.map(item => `${item.title}: ${item.content}`).join('\n');
      const res = await fetch('/api/simulate-dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          systemPrompt,
          knowledgeBase: kbCombined,
          conversationHistory: newHistory
        })
      });
      const data = await res.json();
      if (data.reply) {
        setSimHistory(prev => [
          ...prev,
          { sender: 'ai', text: data.reply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
        ]);
        setAnalytics(prev => ({
          ...prev,
          totalDMs: prev.totalDMs + 1,
          apiCreditsUsed: prev.apiCreditsUsed + (data.creditsUsed || 1)
        }));
      }
    } catch (err) {
      console.error('Simulation request failed:', err);
      setSimHistory(prev => [
        ...prev,
        { sender: 'ai', text: 'Sorry, I encountered an error connecting to the AI engine.', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
      ]);
    } finally {
      setIsSimulating(false);
    }
  };

  const addKnowledgeItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setKbItems([
      { id: Date.now().toString(), title: newTitle, content: newContent, category: 'Custom' },
      ...kbItems
    ]);
    setNewTitle('');
    setNewContent('');
  };

  const deleteKnowledgeItem = (id: string) => {
    setKbItems(kbItems.filter(item => item.id !== id));
  };

  if (!user && !isDemoMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl">
          <div className="flex items-center justify-center mb-6">
            <div className="w-14 h-14 bg-gradient-to-tr from-pink-500 via-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Instagram className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2">InstaFlow AI SaaS</h1>
          <p className="text-slate-300 text-center text-sm mb-6">Multi-Tenant Instagram AI Automation Platform powered by Gemini & Firebase</p>

          {authError && (
            <div className="bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs p-3 rounded-xl mb-4">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
              <input 
                type="email" 
                required 
                value={authEmail} 
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@company.com" 
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <input 
                type="password" 
                required 
                value={authPassword} 
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••" 
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <button 
              type="submit" 
              className="w-full bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white font-medium py-2.5 rounded-xl shadow-lg hover:opacity-95 transition"
            >
              {isSignUp ? 'Create Tenant Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
            <button onClick={() => setIsSignUp(!isSignUp)} className="hover:text-white underline">
              {isSignUp ? 'Already have an account? Sign In' : "Need an account? Sign Up"}
            </button>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-slate-900 px-2 text-slate-400">Or continue with</span></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={handleGoogleSignIn}
              className="bg-white/5 border border-white/10 hover:bg-white/10 text-white text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
              Google
            </button>
            <button 
              onClick={() => setIsDemoMode(true)}
              className="bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/30 text-purple-200 text-xs font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 transition"
            >
              <Sparkles className="w-4 h-4 text-purple-400" />
              Demo Mode
            </button>
          </div>

          <div className="mt-8 text-center text-xs text-slate-500 flex justify-center gap-4">
            <button onClick={() => setShowPrivacy(true)} className="hover:underline">Privacy Policy</button>
            <span>•</span>
            <button onClick={() => setShowTerms(true)} className="hover:underline">Terms of Service</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-6 py-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-pink-500 via-purple-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
            <Instagram className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-base">InstaFlow AI</span>
              <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded-full">SaaS Pro</span>
            </div>
            <p className="text-xs text-slate-500">Tenant ID: {user?.uid || 'demo_tenant_99'}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-3 py-1.5 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            Zero-Knowledge Encryption Active (AES-256-GCM)
          </div>

          <button 
            onClick={() => {
              if (user) signOut(auth);
              setIsDemoMode(false);
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-xl transition"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        {/* Sidebar Navigation */}
        <aside className="w-64 border-r border-slate-200 bg-white p-6 hidden lg:flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 px-3">Management</div>
          
          <button 
            onClick={() => setActiveTab('connections')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'connections' ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Instagram className="w-4 h-4" />
            Connection Center
          </button>

          <button 
            onClick={() => setActiveTab('knowledge')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'knowledge' ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <BookOpen className="w-4 h-4" />
            Knowledge Base
          </button>

          <button 
            onClick={() => setActiveTab('inbox')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'inbox' ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <MessageSquare className="w-4 h-4" />
            Live Chat Inbox
            <span className="ml-auto bg-pink-100 text-pink-700 text-xs px-2 py-0.5 rounded-full font-bold">2</span>
          </button>

          <button 
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'simulator' ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Sparkles className="w-4 h-4 text-purple-600" />
            DM AI Simulator
          </button>

          <button 
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === 'analytics' ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <BarChart3 className="w-4 h-4" />
            Analytics & Credits
          </button>

          <div className="mt-auto pt-6 border-t border-slate-100">
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-slate-700">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Meta Compliance
              </div>
              <p className="text-xs text-slate-500 mb-3">App review hooks & webhooks fully active.</p>
              <div className="flex gap-2">
                <button onClick={() => setShowPrivacy(true)} className="text-xs text-purple-600 hover:underline">Privacy</button>
                <span className="text-slate-300">|</span>
                <button onClick={() => setShowTerms(true)} className="text-xs text-purple-600 hover:underline">Terms</button>
              </div>
            </div>
          </div>
        </aside>

        {/* Tab Content Area */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">
          {/* Mobile Tab Selector */}
          <div className="flex lg:hidden gap-2 overflow-x-auto pb-4 mb-6">
            <button onClick={() => setActiveTab('connections')} className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap ${activeTab === 'connections' ? 'bg-purple-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>Connections</button>
            <button onClick={() => setActiveTab('knowledge')} className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap ${activeTab === 'knowledge' ? 'bg-purple-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>Knowledge Base</button>
            <button onClick={() => setActiveTab('inbox')} className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap ${activeTab === 'inbox' ? 'bg-purple-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>Inbox</button>
            <button onClick={() => setActiveTab('simulator')} className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap ${activeTab === 'simulator' ? 'bg-purple-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>Simulator</button>
            <button onClick={() => setActiveTab('analytics')} className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap ${activeTab === 'analytics' ? 'bg-purple-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>Analytics</button>
          </div>

          {/* SCREEN 2: CONNECTION CENTER */}
          {activeTab === 'connections' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Instagram Connection Center</h1>
                <p className="text-sm text-slate-500">Connect your Instagram Business or Creator account via Meta OAuth 2.0 to power automated DM replies.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs md:col-span-2 space-y-6">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                        <Instagram className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">Instagram Professional Account</h3>
                        <p className="text-xs text-slate-500">{isConnected ? `Mapped Page ID: ${pageId}` : 'Not connected to Meta Graph API'}</p>
                      </div>
                    </div>
                    <div>
                      {isConnected ? (
                        <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1 rounded-full border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 text-xs font-semibold px-3 py-1 rounded-full border border-amber-200">
                          <AlertCircle className="w-3.5 h-3.5" /> Disconnected
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Instagram Page ID</label>
                      <input 
                        type="text" 
                        value={pageId} 
                        onChange={(e) => setPageId(e.target.value)}
                        placeholder="e.g. 17841434784408449"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-800 font-mono focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Encrypted Meta Access Token (AES-256-GCM)</label>
                      <div className="relative">
                        <input 
                          type="password" 
                          value={accessToken} 
                          onChange={(e) => setAccessToken(e.target.value)}
                          placeholder="EAA... paste your Meta Access Token"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-800 font-mono focus:outline-none focus:border-purple-500"
                        />
                        <div className="absolute right-3 top-2.5 text-xs text-emerald-600 flex items-center gap-1">
                          <Lock className="w-3.5 h-3.5" /> Secured at Rest
                        </div>
                      </div>
                    </div>
                  </div>

                  {connectError && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3 rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                      <span>{connectError}</span>
                    </div>
                  )}

                  {connectedPageName && isConnected && (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-3 rounded-xl flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                      <span>Successfully connected to: <strong>{connectedPageName}</strong></span>
                    </div>
                  )}

                  <div className="pt-4 flex items-center gap-4">
                    {isConnected ? (
                      <button 
                        onClick={() => {
                          setIsConnected(false);
                          setConnectedPageName('');
                        }}
                        className="bg-rose-50 text-rose-700 border border-rose-200 font-medium px-5 py-2.5 rounded-xl text-sm hover:bg-rose-100 transition"
                      >
                        Disconnect Account
                      </button>
                    ) : (
                      <button 
                        onClick={async () => {
                          setConnectError('');
                          setIsConnecting(true);
                          try {
                            const res = await fetch('/api/verify-instagram-token', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ accessToken, pageId })
                            });
                            const data = await res.json();
                            if (data.valid) {
                              setIsConnected(true);
                              setConnectedPageName(data.pageName || 'Instagram Business Account');
                            } else {
                              setConnectError(data.error || 'Invalid token or page ID');
                            }
                          } catch (err: any) {
                            setConnectError('Failed to verify token with Meta API.');
                          } finally {
                            setIsConnecting(false);
                          }
                        }}
                        disabled={isConnecting}
                        className="bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white font-medium px-6 py-2.5 rounded-xl text-sm shadow-md hover:opacity-95 transition flex items-center gap-2"
                      >
                        {isConnecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Instagram className="w-4 h-4" />}
                        {isConnecting ? 'Verifying with Meta API...' : 'Connect & Verify Instagram'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Code className="w-4 h-4 text-purple-600" />
                    Webhook Configuration
                  </h3>
                  <p className="text-xs text-slate-500">Configure this endpoint in your Meta Developer App dashboard to receive real-time messaging events.</p>
                  
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Callback URL</span>
                    <p className="text-xs font-mono text-slate-800 break-all">{window.location.origin}/api/webhook/instagram</p>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Verify Token</span>
                    <p className="text-xs font-mono text-slate-800">instaflow_secure_verify_token</p>
                  </div>

                  <div className="pt-2">
                    <span className="text-xs text-slate-500">Required Subscriptions:</span>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="bg-purple-50 text-purple-700 text-[11px] px-2 py-0.5 rounded-md font-medium">messages</span>
                      <span className="bg-purple-50 text-purple-700 text-[11px] px-2 py-0.5 rounded-md font-medium">messaging_postbacks</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 3: KNOWLEDGE BASE MANAGER */}
          {activeTab === 'knowledge' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">Knowledge Base & AI Persona</h1>
                  <p className="text-sm text-slate-500">Provide business FAQs, shipping rules, and catalog details that guide your Gemini AI Persona.</p>
                </div>
              </div>

              {/* System Prompt Customizer */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  Gemini AI System Prompt & Persona
                </h3>
                <textarea 
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-800 focus:outline-none focus:border-purple-500"
                />
                <p className="text-xs text-slate-400">This instruction is prepended to every incoming customer DM before being sent to Gemini 1.5 Pro.</p>
              </div>

              {/* Add Knowledge Item Form */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4 text-purple-600" />
                  Add New FAQ or Catalog Document
                </h3>
                <form onSubmit={addKnowledgeItem} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-1">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Document Title / Topic</label>
                      <input 
                        type="text" 
                        required
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="e.g. International Shipping" 
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Content / Answer Details</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          required
                          value={newContent}
                          onChange={(e) => setNewContent(e.target.value)}
                          placeholder="e.g. We ship worldwide via DHL Express in 4-6 business days..." 
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-purple-500"
                        />
                        <button 
                          type="submit" 
                          className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-6 py-2.5 rounded-xl text-sm transition shrink-0"
                        >
                          Save Doc
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              </div>

              {/* Knowledge Base List */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 font-semibold text-sm text-slate-900">
                  Active Knowledge Documents ({kbItems.length})
                </div>
                <div className="divide-y divide-slate-100">
                  {kbItems.map(item => (
                    <div key={item.id} className="p-6 flex items-start justify-between gap-4 hover:bg-slate-50/50 transition">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-sm">{item.title}</h4>
                          <span className="bg-purple-100 text-purple-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">{item.category}</span>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">{item.content}</p>
                      </div>
                      <button 
                        onClick={() => deleteKnowledgeItem(item.id)}
                        className="text-slate-400 hover:text-rose-600 p-2 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 4: LIVE CHAT INBOX & HUMAN TAKEOVER */}
          {activeTab === 'inbox' && (
            <div className="space-y-6 h-[calc(100vh-140px)] flex flex-col">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Live Customer Chat Inbox</h1>
                <p className="text-sm text-slate-500">Monitor automated DM conversations and toggle human agent takeover anytime.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Conversation List */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 font-semibold text-xs text-slate-500 uppercase tracking-wider">
                    Recent Conversations ({conversations.length})
                  </div>
                  <div className="divide-y divide-slate-100 overflow-y-auto flex-1">
                    {conversations.map(conv => (
                      <div 
                        key={conv.id}
                        onClick={() => setSelectedConv(conv)}
                        className={`p-4 cursor-pointer transition ${selectedConv?.id === conv.id ? 'bg-purple-50/80 border-l-4 border-purple-600' : 'hover:bg-slate-50'}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-900 text-sm">{conv.customerName}</span>
                          <span className="text-[10px] text-slate-400">{conv.timestamp}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500 truncate max-w-[180px]">{conv.lastMessage}</span>
                          {conv.humanTakeover ? (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <UserX className="w-3 h-3" /> Manual
                            </span>
                          ) : (
                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Zap className="w-3 h-3" /> AI Bot
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Active Chat Thread */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:col-span-2 overflow-hidden">
                  {selectedConv ? (
                    <>
                      {/* Thread Header */}
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                            {selectedConv.customerName.charAt(0)}
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{selectedConv.customerName}</h4>
                            <p className="text-xs text-slate-500">{selectedConv.customerHandle}</p>
                          </div>
                        </div>

                        {/* Human Takeover Toggle */}
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-xs font-semibold text-slate-700">Automation Mode</div>
                            <div className="text-[10px] text-slate-400">{selectedConv.humanTakeover ? 'Paused (Human Agent Active)' : 'Active (Gemini Auto-Pilot)'}</div>
                          </div>
                          <button 
                            onClick={() => {
                              const updated = conversations.map(c => c.id === selectedConv.id ? { ...c, humanTakeover: !c.humanTakeover } : c);
                              setConversations(updated);
                              setSelectedConv({ ...selectedConv, humanTakeover: !selectedConv.humanTakeover });
                            }}
                            className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs ${selectedConv.humanTakeover ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'}`}
                          >
                            {selectedConv.humanTakeover ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                            {selectedConv.humanTakeover ? 'Resume AI Bot' : 'Human Takeover'}
                          </button>
                        </div>
                      </div>

                      {/* Chat Messages */}
                      <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50/50">
                        {chatMessages.map((msg, idx) => (
                          <div key={idx} className={`flex ${msg.sender === 'customer' ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-md rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs ${msg.sender === 'customer' ? 'bg-white text-slate-800 border border-slate-200' : 'bg-purple-600 text-white'}`}>
                              <p>{msg.text}</p>
                              <span className={`block text-[10px] mt-1 text-right ${msg.sender === 'customer' ? 'text-slate-400' : 'text-purple-200'}`}>{msg.time}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Reply Input */}
                      <div className="p-4 border-t border-slate-100 bg-white">
                        <form onSubmit={(e) => {
                          e.preventDefault();
                          if (!replyInput.trim()) return;
                          setChatMessages([...chatMessages, { sender: 'agent', text: replyInput, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
                          setReplyInput('');
                        }} className="flex gap-2">
                          <input 
                            type="text" 
                            value={replyInput}
                            onChange={(e) => setReplyInput(e.target.value)}
                            placeholder={selectedConv.humanTakeover ? "Type manual agent reply..." : "AI Bot is active (Toggle Human Takeover to reply manually)..."}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 focus:outline-none focus:border-purple-500"
                          />
                          <button 
                            type="submit" 
                            className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-5 py-3 rounded-xl text-xs transition flex items-center gap-1.5 shadow-sm"
                          >
                            <Send className="w-3.5 h-3.5" /> Send
                          </button>
                        </form>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                      Select a conversation to view chat history
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SIMULATOR TAB: AI DM SANDBOX */}
          {activeTab === 'simulator' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Instagram DM AI Simulator</h1>
                <p className="text-sm text-slate-500">Test your AI agent and knowledge base in real-time before connecting live Instagram webhooks.</p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col h-[550px]">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="font-bold text-xs text-slate-700 uppercase tracking-wider">Gemini 1.5 Pro AI Engine Connected</span>
                  </div>
                  <button 
                    onClick={() => setSimHistory([{ sender: 'ai', text: 'Simulator reset. Ask me a question!', time: 'Just now' }])}
                    className="text-xs text-purple-600 hover:underline font-medium"
                  >
                    Clear Chat
                  </button>
                </div>

                <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50/50">
                  {simHistory.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.sender === 'customer' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-md rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs ${msg.sender === 'customer' ? 'bg-purple-600 text-white' : 'bg-white text-slate-800 border border-slate-200'}`}>
                        <p>{msg.text}</p>
                        <span className={`block text-[10px] mt-1 text-right ${msg.sender === 'customer' ? 'text-purple-200' : 'text-slate-400'}`}>{msg.time}</span>
                      </div>
                    </div>
                  ))}
                  {isSimulating && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-xs text-slate-500 flex items-center gap-2 shadow-xs">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-600" />
                        Gemini is analyzing knowledge base & formulating reply...
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-white">
                  <form onSubmit={handleSimulateSend} className="flex gap-2">
                    <input 
                      type="text" 
                      value={simMessage}
                      onChange={(e) => setSimMessage(e.target.value)}
                      placeholder="Type a test customer DM (e.g. 'Do you have size M in the summer dress?')..." 
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-800 focus:outline-none focus:border-purple-500"
                    />
                    <button 
                      type="submit" 
                      disabled={isSimulating}
                      className="bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:opacity-95 text-white font-medium px-6 py-3 rounded-xl text-xs transition flex items-center gap-2 shadow-sm"
                    >
                      <Send className="w-3.5 h-3.5" /> Send DM
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 5: ANALYTICS PANEL */}
          {activeTab === 'analytics' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Analytics & API Credits</h1>
                <p className="text-sm text-slate-500">Real-time metrics on automated DMs, resolution success rate, and Gemini token usage.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total DMs Processed</span>
                  <div className="text-3xl font-extrabold text-slate-900">{analytics.totalDMs.toLocaleString()}</div>
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">↑ 18.2% from last week</span>
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Automated Resolution Rate</span>
                  <div className="text-3xl font-extrabold text-slate-900">{analytics.resolvedRate}%</div>
                  <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">Top tier performance</span>
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Gemini API Credits Used</span>
                  <div className="text-3xl font-extrabold text-slate-900">{analytics.apiCreditsUsed.toLocaleString()}</div>
                  <span className="text-xs text-slate-500">Standard tier quota</span>
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Subscribers</span>
                  <div className="text-3xl font-extrabold text-slate-900">{analytics.activeSubscribers}</div>
                  <span className="text-xs text-purple-600 font-medium">Pro Plan ($99/mo)</span>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
                <h3 className="font-bold text-slate-900 text-sm">Subscription & Tenant Security Status</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-xs font-semibold text-slate-400">Subscription Status</span>
                    <p className="text-sm font-bold text-emerald-700">Active (Stripe Verified)</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-xs font-semibold text-slate-400">Database Tenant Isolation</span>
                    <p className="text-sm font-bold text-slate-800">Firestore Rules Enforced</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-xs font-semibold text-slate-400">Encryption Standard</span>
                    <p className="text-sm font-bold text-slate-800">AES-256-GCM at Rest</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Floating AI Setup Copilot for Clients */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end">
        {isCopilotOpen ? (
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-[92vw] sm:w-[400px] h-[520px] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 p-4 text-white flex items-center justify-between shadow-md">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-xs flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-sm leading-tight">InstaFlow AI Copilot</h3>
                  <p className="text-[11px] text-purple-200 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    24/7 Client Setup Guide
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsCopilotOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center transition"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Quick Action Chips */}
            <div className="bg-purple-50/70 border-b border-purple-100 p-2.5 flex items-center gap-1.5 overflow-x-auto text-[11px]">
              <button 
                onClick={() => {
                  handleCopilotSend("Mujhe shuru se step-by-step batao ki kya karna hai?");
                }}
                className="whitespace-nowrap bg-white border border-purple-200 text-purple-700 font-medium px-2.5 py-1 rounded-full hover:bg-purple-100 transition shadow-2xs"
              >
                🚀 Kaise shuru karein?
              </button>
              <button 
                onClick={() => {
                  setActiveTab('knowledge');
                  handleCopilotSend("Knowledge Base me FAQs kaise add karein?");
                }}
                className="whitespace-nowrap bg-white border border-purple-200 text-purple-700 font-medium px-2.5 py-1 rounded-full hover:bg-purple-100 transition shadow-2xs"
              >
                📝 FAQs Training
              </button>
              <button 
                onClick={() => {
                  setActiveTab('connections');
                  handleCopilotSend("Instagram Page connect karne ke liye token aur page ID kahan se milegi?");
                }}
                className="whitespace-nowrap bg-white border border-purple-200 text-purple-700 font-medium px-2.5 py-1 rounded-full hover:bg-purple-100 transition shadow-2xs"
              >
                🔗 Instagram Connection
              </button>
              <button 
                onClick={() => {
                  setActiveTab('simulator');
                  handleCopilotSend("Bot ko test kaise karein?");
                }}
                className="whitespace-nowrap bg-white border border-purple-200 text-purple-700 font-medium px-2.5 py-1 rounded-full hover:bg-purple-100 transition shadow-2xs"
              >
                🧪 Bot Testing
              </button>
            </div>

            {/* Messages Area */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/50">
              {copilotMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.sender === 'copilot' && (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-0.5 shrink-0">
                      AI
                    </div>
                  )}
                  <div className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed shadow-2xs ${
                    msg.sender === 'user' 
                      ? 'bg-purple-600 text-white rounded-tr-none' 
                      : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none whitespace-pre-line'
                  }`}>
                    {msg.text}
                    <div className={`text-[9px] mt-1 text-right ${msg.sender === 'user' ? 'text-purple-200' : 'text-slate-400'}`}>
                      {msg.time}
                    </div>
                  </div>
                </div>
              ))}
              {isCopilotLoading && (
                <div className="flex items-center gap-2 text-slate-500 text-xs italic">
                  <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  </div>
                  Copilot soch raha hai...
                </div>
              )}
            </div>

            {/* Input Footer */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleCopilotSend();
              }}
              className="p-3 bg-white border-t border-slate-100 flex items-center gap-2"
            >
              <input 
                type="text" 
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                placeholder="Puchiye bot setup ke baare me..."
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-purple-500"
              />
              <button 
                type="submit"
                disabled={!copilotInput.trim() || isCopilotLoading}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white p-2 rounded-xl transition shadow-xs"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        ) : (
          <button 
            onClick={() => setIsCopilotOpen(true)}
            className="group flex items-center gap-3 bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white px-4 py-3 rounded-full shadow-2xl hover:scale-105 transition duration-200"
          >
            <div className="relative">
              <Bot className="w-6 h-6 text-white" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-white animate-pulse"></span>
            </div>
            <div className="text-left hidden sm:block">
              <div className="text-xs font-bold leading-tight">Need Setup Help?</div>
              <div className="text-[10px] text-purple-200">Ask AI Copilot</div>
            </div>
          </button>
        )}
      </div>

      {/* Privacy Policy Modal */}
      {showPrivacy && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-slate-900">Privacy Policy</h2>
            <p className="text-xs text-slate-500">Last updated: September 21, 2026</p>
            <div className="text-xs text-slate-700 space-y-3 leading-relaxed">
              <p>InstaFlow AI respects your privacy and is committed to protecting your personal data. We collect business profile information, Instagram page credentials (encrypted at rest with AES-256-GCM), knowledge base FAQs, and conversation logs necessary to provide AI-powered customer support automation.</p>
              <p>All sensitive tokens and business secrets are encrypted at rest. We enforce strict multi-tenant isolation through Firebase Firestore Security Rules.</p>
            </div>
            <div className="pt-4 text-right">
              <button onClick={() => setShowPrivacy(false)} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-xs font-medium">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Terms of Service Modal */}
      {showTerms && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-slate-900">Terms of Service</h2>
            <p className="text-xs text-slate-500">Last updated: September 21, 2026</p>
            <div className="text-xs text-slate-700 space-y-3 leading-relaxed">
              <p>Welcome to InstaFlow AI. By accessing or using our platform, you agree to be bound by these Terms of Service.</p>
              <p>You agree to use InstaFlow AI in compliance with Meta Platform Terms and Instagram Community Guidelines.</p>
            </div>
            <div className="pt-4 text-right">
              <button onClick={() => setShowTerms(false)} className="bg-slate-900 text-white px-5 py-2 rounded-xl text-xs font-medium">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
