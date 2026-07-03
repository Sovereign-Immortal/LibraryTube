import React, { useState, useEffect } from 'react';
import { AIContent } from '../../shared/types';
import { formatTime } from '../../shared/utils';
import { fetchTranscript } from '../../background/transcript';

const getFriendlyErrorMessage = (message: string) => {
  if (message.includes('Could not establish connection') || message.includes('context invalidated')) {
    return 'Extension was reloaded or updated. Please refresh the page to reconnect.';
  }
  return message;
};

interface ReaderModalProps {
  videoId: string;
  onUnlock: () => void;
  onClose: () => void;
}

type TabType = 'summary' | 'points' | 'critique' | 'script';
type FontStyle = 'serif' | 'sans';
type FontSize = 'sm' | 'md' | 'lg';

const ReaderModal: React.FC<ReaderModalProps> = ({ videoId, onUnlock, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [fontStyle, setFontStyle] = useState<FontStyle>('sans');
  const [fontSize, setFontSize] = useState<FontSize>('lg');
  const [content, setContent] = useState<AIContent | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // State for the picture-in-picture mini player
  const [miniPlayerTime, setMiniPlayerTime] = useState<number | null>(null);

  const getPlayerResponseFromPage = (): Promise<any> => {
    return new Promise((resolve) => {
      // 1. Check if we can find it in script tags first (no injection needed)
      try {
        const scripts = document.querySelectorAll('script');
        for (const script of Array.from(scripts)) {
          const text = script.textContent || '';
          if (text.includes('ytInitialPlayerResponse')) {
            const match = text.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
            if (match && match[1]) {
              const parsed = JSON.parse(match[1]);
              if (parsed && parsed.videoDetails && parsed.videoDetails.videoId === videoId) {
                resolve(parsed);
                return;
              }
            }
          }
        }
      } catch (e) {
        console.warn('Error reading script tags:', e);
      }

      // 2. Inject a script to extract from window context (prioritizing active movie_player for SPA navigation)
      try {
        const randomId = 'librotube_data_' + Math.random().toString(36).slice(2, 9);
        const script = document.createElement('script');
        script.textContent = `
          (function() {
            try {
              // Prioritize movie_player which is updated dynamically during SPA navigation
              let response = null;
              const player = document.getElementById('movie_player');
              if (player && typeof player.getPlayerResponse === 'function') {
                response = player.getPlayerResponse();
              }
              
              if (!response) {
                response = window.ytInitialPlayerResponse || 
                  (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.player_response);
              }
              
              if (response) {
                const data = typeof response === 'string' ? response : JSON.stringify(response);
                const div = document.createElement('div');
                div.id = "${randomId}";
                div.style.display = 'none';
                div.textContent = data;
                document.body.appendChild(div);
              }
            } catch (e) {
              console.error('Error in LibroTube injected script:', e);
            }
          })();
        `;
        
        document.documentElement.appendChild(script);

        setTimeout(() => {
          const div = document.getElementById(randomId);
          if (div) {
            const content = div.textContent;
            div.remove();
            script.remove();
            if (content) {
              try {
                const parsed = JSON.parse(content);
                // Validate that this response actually belongs to the active videoId!
                if (parsed && parsed.videoDetails && parsed.videoDetails.videoId === videoId) {
                  resolve(parsed);
                  return;
                } else {
                  console.warn('Injected response videoId mismatch. Expected:', videoId, 'Got:', parsed?.videoDetails?.videoId);
                }
              } catch (e) {
                console.warn('Failed to parse injected content:', e);
              }
            }
          }
          script.remove();
          resolve(null);
        }, 100);
      } catch (err) {
        console.warn('Failed to inject script:', err);
        resolve(null);
      }
    });
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    setMiniPlayerTime(null);

    // Get the player response from the page context, fetch the transcript, and call the background script
    getPlayerResponseFromPage().then(async (playerResponse) => {
      // Extract metadata for fallback and contextual prompting
      let title = '';
      let description = '';
      let author = '';

      if (playerResponse && playerResponse.videoDetails) {
        title = playerResponse.videoDetails.title || '';
        description = playerResponse.videoDetails.shortDescription || '';
        author = playerResponse.videoDetails.author || '';
      }

      if (!title) {
        title = document.querySelector('meta[name="title"]')?.getAttribute('content') || 
                document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim() || 
                document.title.replace(' - YouTube', '') || 
                '';
      }
      if (!description) {
        description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
      }
      if (!author) {
        author = document.querySelector('link[itemprop="name"]')?.getAttribute('content') || 
                 document.querySelector('#upload-info .ytd-channel-name a')?.textContent?.trim() || 
                 '';
      }

      const metadata = { title, description, author };

      try {
        const segments = await fetchTranscript(videoId, playerResponse);
        if (!segments || segments.length === 0) {
          throw new Error('No transcript segments could be parsed from YouTube.');
        }

        chrome.runtime.sendMessage(
          { action: 'getVideoContent', videoId, segments, metadata },
          (response) => {
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || 'Communication error with extension background.';
              setError(getFriendlyErrorMessage(errMsg));
              setLoading(false);
              return;
            }

            if (response && response.success) {
              setContent(response.content);
            } else {
              setError(response?.error || 'Failed to generate summary.');
            }
            setLoading(false);
          }
        );
      } catch (err: any) {
        console.warn('Captions failed. Attempting Gemini metadata fallback...', err);
        chrome.runtime.sendMessage(
          { action: 'getVideoContent', videoId, segments: null, metadata },
          (response) => {
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message || 'Communication error with extension background.';
              setError(getFriendlyErrorMessage(errMsg));
              setLoading(false);
              return;
            }

            if (response && response.success) {
              setContent(response.content);
            } else {
              setError(response?.error || 'Failed to transcribe/summarize video.');
            }
            setLoading(false);
          }
        );
      }
    });
  }, [videoId]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key.toLowerCase() === 'w') {
        // Only trigger if not typing inside an input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          onUnlock();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onUnlock]);

  const handleCitationClick = (seconds: number) => {
    setMiniPlayerTime(seconds);
  };

  const handleTranscriptClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('transcript-timestamp')) {
      const timeAttr = target.getAttribute('data-time');
      if (timeAttr) {
        const seconds = parseFloat(timeAttr);
        handleCitationClick(seconds);
      }
    }
  };

  const formatCritiqueParagraph = (para: string, index: number) => {
    const text = para.trim();
    if (!text) return null;

    if (text.startsWith('### ')) {
      return <h3 key={index} className="critique-h3">{text.slice(4)}</h3>;
    }
    if (text.startsWith('## ')) {
      return <h2 key={index} className="critique-h2">{text.slice(3)}</h2>;
    }

    const numberedMatch = text.match(/^(\d+)\.\s+\*\*(.*?)\*\*(.*)$/s);
    if (numberedMatch) {
      return (
        <div key={index} className="critique-item numbered">
          <span className="critique-number">{numberedMatch[1]}</span>
          <div className="critique-item-content">
            <strong className="critique-item-title">{numberedMatch[2]}</strong>
            <span>{numberedMatch[3]}</span>
          </div>
        </div>
      );
    }

    const bulletMatch = text.match(/^[-*]\s+\*\*(.*?)\*\*(.*)$/s);
    if (bulletMatch) {
      return (
        <div key={index} className="critique-item bullet">
          <span className="critique-bullet">✦</span>
          <div className="critique-item-content">
            <strong className="critique-item-title">{bulletMatch[2]}</strong>
            <span>{bulletMatch[3]}</span>
          </div>
        </div>
      );
    }

    const cleanText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return (
      <p 
        key={index} 
        className="critique-para"
        dangerouslySetInnerHTML={{ __html: cleanText }}
      />
    );
  };

  const renderSkeleton = () => (
    <div className="prose">
      <div className="skeleton skeleton-title"></div>
      <div className="skeleton skeleton-paragraph"></div>
      <div className="skeleton skeleton-paragraph"></div>
      <div className="skeleton skeleton-paragraph"></div>
      <div className="skeleton skeleton-paragraph short"></div>
      <div className="skeleton skeleton-paragraph"></div>
      <div className="skeleton skeleton-paragraph"></div>
      <div className="skeleton skeleton-paragraph short"></div>
    </div>
  );

  const renderContent = () => {
    if (!content) return null;

    switch (activeTab) {
      case 'summary':
        return (
          <div className="prose">
            <h2 className="section-title">Executive Summary</h2>
            <div className="summary-text">{content.summary}</div>
            <p style={{ color: 'var(--text-muted)' }}>
              Use the sidebar links to navigate the detailed sections of this video transcript. Click on blue citation links to view specific parts.
            </p>
          </div>
        );
      case 'points':
        return (
          <div>
            <h2 className="section-title" style={{ marginBottom: '1rem' }}>Key Takeaways</h2>
            
            <h3 style={{ margin: '1.5rem 0 1rem', color: 'var(--success-color)' }}>Strengths & Key Claims</h3>
            <div className="point-list">
              {content.strengths.map((pt, i) => (
                <div key={`str-${i}`} className="point-card strength">
                  <div className="point-title">{pt.point}</div>
                  {pt.quote && <span className="point-quote">"{pt.quote}"</span>}
                  <span className="citation" onClick={() => handleCitationClick(pt.timestamp)}>
                    [{formatTime(pt.timestamp)}]
                  </span>
                </div>
              ))}
            </div>

            <h3 style={{ margin: '2.5rem 0 1rem', color: 'var(--danger-color)' }}>Weaknesses & Logical Flaws</h3>
            <div className="point-list">
              {content.weaknesses.map((pt, i) => (
                <div key={`weak-${i}`} className="point-card weakness">
                  <div className="point-title">{pt.point}</div>
                  {pt.quote && <span className="point-quote">"{pt.quote}"</span>}
                  <span className="citation" onClick={() => handleCitationClick(pt.timestamp)}>
                    [{formatTime(pt.timestamp)}]
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      case 'critique':
        return (
          <div className="prose">
            <h2 className="section-title">Critical Analysis</h2>
            {content.critique.split('\n\n').map((para, i) => formatCritiqueParagraph(para, i))}
          </div>
        );
      case 'script':
        return (
          <div className="prose">
            <h2 className="section-title">Formatted Transcript</h2>
            <div 
              className="prose-body"
              onClick={handleTranscriptClick}
              dangerouslySetInnerHTML={{ __html: content.formattedTranscript }}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="librotube-modal-wrapper">
      {/* Left Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <img src={chrome.runtime.getURL('logo.png')} className="logo-img" alt="LibroTube Logo" />
          <div className="logo">LibroTube</div>
          <div className="logo-tagline">YouTube into a Library</div>
        </div>

        <ul className="toc-menu">
          <li 
            className={`toc-item ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            📖 Summary
          </li>
          <li 
            className={`toc-item ${activeTab === 'points' ? 'active' : ''}`}
            onClick={() => setActiveTab('points')}
          >
            💡 Key Takeaways
          </li>
          <li 
            className={`toc-item ${activeTab === 'critique' ? 'active' : ''}`}
            onClick={() => setActiveTab('critique')}
          >
            ⚖️ Editorial Critique
          </li>
          <li 
            className={`toc-item ${activeTab === 'script' ? 'active' : ''}`}
            onClick={() => setActiveTab('script')}
          >
            📝 Full Transcript
          </li>
        </ul>

        <div className="sidebar-footer">
          <button className="btn-watch" onClick={onUnlock}>
            🔓 Unlock & Watch
          </button>
          <button className="btn-close" onClick={onClose}>
            Close Reader
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        <div className="content-header">
          <div className="video-meta">
            {loading ? 'Analyzing video stream...' : `Video ID: ${videoId}`}
          </div>
          <div className="reading-controls">
            <button 
              className="control-btn" 
              onClick={() => setFontStyle(p => p === 'serif' ? 'sans' : 'serif')}
            >
              Font: {fontStyle === 'serif' ? 'Serif' : 'Sans'}
            </button>
            <button 
              className="control-btn" 
              onClick={() => setFontSize(p => p === 'sm' ? 'md' : p === 'md' ? 'lg' : 'sm')}
            >
              Size: {fontSize.toUpperCase()}
            </button>
          </div>
        </div>

        <div className={`content-body ${fontStyle} size-${fontSize}`}>
          {loading && renderSkeleton()}
          
          {!loading && error && (
            <div className="error-panel" style={{ color: 'var(--danger-color)', padding: '2rem 0' }}>
              <h3>Failed to parse video</h3>
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && renderContent()}
        </div>
      </div>

      {/* Picture-in-Picture Mini-Player Overlay */}
      {miniPlayerTime !== null && (
        <div className="mini-player-overlay">
          <div className="mini-player-header">
            <span className="mini-player-title">Citation View - {formatTime(miniPlayerTime)}</span>
            <button className="mini-player-close" onClick={() => setMiniPlayerTime(null)}>
              ✕
            </button>
          </div>
          <iframe
            className="mini-player-iframe"
            src={`https://www.youtube.com/embed/${videoId}?start=${Math.floor(miniPlayerTime)}&autoplay=1&mute=0`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
    </div>
  );
};

export default ReaderModal;
