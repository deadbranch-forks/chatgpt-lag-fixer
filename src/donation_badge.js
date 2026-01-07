// src/donation_badge.js
(function () {
  const scroller = window.ChatGPTVirtualScroller;
  // Use centralized logger
  const log = scroller.log || console.log;
  
  const BADGE_ATTRIBUTE = "data-chatgpt-donation-badge";

  class DonationBadge {
    constructor() {
      this.isVisible = false;
      this.lastMilestone = 0;
      this.heartInterval = null;
      this.autoCloseTimeout = null;
      this.previousTotalMessages = 0;
    }

    reset() {
      this.forceHide();
      this.lastMilestone = 0;
      this.previousTotalMessages = 0;
      this.isVisible = false;
    }

    injectStyles() {
      const ID = "cvs-donation-styles";
      if (document.getElementById(ID)) return;
      const style = document.createElement("style");
      style.id = ID;
      style.textContent = `
        @keyframes floatHeart {
          0% { transform: translateY(20px) translateX(0) scale(0.6); opacity: 0; }
          20% { opacity: 0.8; transform: translateY(0) translateX(-4px) scale(0.8); } 
          50% { transform: translateY(-20px) translateX(4px) scale(1); }
          80% { opacity: 0.6; }
          100% { transform: translateY(-50px) translateX(-2px) scale(1.1); opacity: 0; }
        }
        @keyframes heart-explode {
          0% { transform: translate(0, 0) scale(0.5) rotate(0); opacity: 1; }
          50% { opacity: 1; transform: translate(var(--tx), var(--ty)) scale(1.2) rotate(var(--rot)); }
          100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
        }
        @keyframes glow-pulse {
          0% { box-shadow: 0 8px 24px rgba(243, 156, 18, 0.4); }
          50% { box-shadow: 0 12px 32px rgba(243, 156, 18, 0.8); }
          100% { box-shadow: 0 8px 24px rgba(243, 156, 18, 0.4); }
        }
        .cvs-heart-float {
          position: absolute;
          bottom: -15px;
          pointer-events: none;
          animation: floatHeart 3s ease-in-out forwards;
          opacity: 0; 
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
          z-index: 0; 
        }
        .cvs-donation-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 12px 20px;
          border-radius: 16px;
          font-size: 15px;
          font-weight: 600;
          color: #ffffff;
          background: linear-gradient(135deg, #f1c40f, #e67e22);
          backdrop-filter: blur(8px);
          opacity: 0;
          transform: translateY(50px) scale(0.9);
          transition: 
            opacity 400ms cubic-bezier(0.19, 1, 0.22, 1), 
            transform 400ms cubic-bezier(0.19, 1, 0.22, 1), 
            box-shadow 180ms ease-out,
            filter 180ms ease-out;
          overflow: hidden;
          cursor: pointer;
          z-index: 9999;
          animation: glow-pulse 3s infinite ease-in-out;
          max-width: 575px;
        }
        .cvs-donation-badge:hover {
          transform: translateY(-2px) scale(1.02) !important;
          filter: brightness(1.1);
        }

        .cvs-heart-particle {
          position: fixed;
          pointer-events: none;
          z-index: 10000;
          will-change: transform, opacity;
          animation: heart-explode var(--duration) cubic-bezier(0.25, 1, 0.5, 1) forwards;
          font-family: "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif;
          white-space: nowrap;
        }
      `;
      document.head.appendChild(style);
    }

    triggerHeartExplosion(x, y) {
      const items = ["❤️", "💖", "🍺", "🍺", "Thank You!", "Thank You!"];
      const particles = 50;
      
      const container = document.createElement("div");
      Object.assign(container.style, {
        position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: "10000"
      });
      document.body.appendChild(container);

      for (let i = 0; i < particles; i++) {
        const p = document.createElement("div");
        p.className = "cvs-heart-particle";
        const content = items[Math.floor(Math.random() * items.length)];
        p.textContent = content;
        
        // Special styling for text
        if (content.length > 2) {
           p.style.fontSize = `${Math.floor(Math.random() * 4) + 12}px`; // 12-16px
           p.style.fontWeight = "bold";
           p.style.color = "#ffffff";
           p.style.textShadow = "0 1px 3px rgba(0,0,0,0.3)";
        } else {
           p.style.fontSize = `${Math.floor(Math.random() * 14) + 14}px`; // 14-28px
        }
        
        p.style.left = x + "px";
        p.style.top = y + "px";
        
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 200 + 80; 
        
        const tx = Math.cos(angle) * velocity;
        const ty = Math.sin(angle) * velocity;
        const rot = Math.random() * 60 - 30;

        p.style.setProperty("--tx", `${tx}px`);
        p.style.setProperty("--ty", `${ty}px`);
        p.style.setProperty("--rot", `${rot}deg`);
        p.style.setProperty("--duration", `${0.6 + Math.random() * 0.4}s`); 

        container.appendChild(p);
      }

      setTimeout(() => container.remove(), 1000);
    }

    show(bodyText = null, headerText = null) {
      if (this.isVisible) return;

      // Rate limit check: Don't show if shown in last 30 mins
      const lastShown = localStorage.getItem("chatgpt_virtual_scroller_donation_last_shown");
      const REAPPEAR_DELAY = 10 * 60 * 1000; // 10 mins
      if (lastShown) {
          const timeSinceMsg = Date.now() - parseInt(lastShown, 10);
          if (timeSinceMsg < REAPPEAR_DELAY) {
              log("[DonationBadge] Rate limited (shown recently). Skipping.");
              return;
          }
      }

      log("[DonationBadge] Attempting to show nudge...");
      
      let text = bodyText;
      let header = headerText;

      if (!text) {
        // Smart Initial Nudge
        const total = (scroller.state && scroller.state.stats) ? scroller.state.stats.totalMessages : 0;
        
        // ONLY show if > 50 messages
        if (total < 50) {
            log("[DonationBadge] Chat too small (<50), skipping nudge.");
            return;
        }

        const rounded = Math.floor(total / 10) * 10;
        header = `High Five! ✋ ${rounded}+ messages lag-free in this chat!`;
        text = `Loving my free extension? Keep it free & fast. <u>Buy me a beer!</u> 🍻`;
      }

      // Update timestamp
      localStorage.setItem("chatgpt_virtual_scroller_donation_last_shown", Date.now().toString());

      this.isVisible = true;
      this.injectStyles();

      // If the "Speed Booster Active" badge is visible, move it up to avoid overlap
      const activeBadge = document.querySelector('[data-chatgpt-virtual-scroller-badge]');
      if (activeBadge) {
          activeBadge.style.transition = "bottom 0.4s cubic-bezier(0.19, 1, 0.22, 1)";
          activeBadge.style.bottom = "180px";
      }

      const badge = document.createElement("div");
      badge.className = "cvs-donation-badge";
      badge.setAttribute(BADGE_ATTRIBUTE, "1");
      
      badge.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:flex-start; position:relative; z-index:2;">
          ${header ? `
          <div style="font-size:15px; font-weight:800; opacity:1; margin-bottom:2px; display:flex; align-items:center; gap:3px; color:rgba(255,255,255,0.95);">
             <span>${header}</span>
          </div>` : ''}
          <div style="display:flex; align-items:flex-start; gap:8px;">
            <span style="font-size:18px; line-height:1.2">🍺</span>
            <span style="font-size:14px; text-shadow:0 1px 2px rgba(0,0,0,0.2); font-weight:600; line-height:1.3;">${text}</span>
          </div>
        </div>
        <div class="close-btn" style="margin-left:16px; cursor:pointer; opacity:0.8; font-size:14px; position:relative; z-index:2; align-self:center;">✕</div>
      `;

      // Position logic
      const inputEl = document.querySelector("#prompt-textarea");
      let targetEl = inputEl;
      if (inputEl) {
         const wrapper = inputEl.closest('[class*="bg-token-bg-primary"]') || inputEl.closest('form');
         if (wrapper) targetEl = wrapper;
      }

      let posStyles = {
        position: "fixed",
        left: "20px",
        bottom: "150px"
      };

      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const bottomFromTop = window.innerHeight - rect.top + 10;
        posStyles = {
          position: "fixed",
          left: `${rect.left}px`,
          bottom: `${bottomFromTop}px`,
          top: "auto",
          right: "auto"
        };
      }

      Object.assign(badge.style, posStyles);

      // CLICK HANDLER
      badge.addEventListener("click", (e) => {
        if (e.target.closest(".close-btn")) return;
        e.preventDefault(); 
        const rect = badge.getBoundingClientRect();
        this.triggerHeartExplosion(rect.left + rect.width / 2, rect.top + rect.height / 2);
        this.hide(badge);
        setTimeout(() => window.open("https://ko-fi.com/bramgiessen", "_blank"), 400);
      });

      // Close handler
      const closeBtn = badge.querySelector(".close-btn");
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.hide(badge);
      });
      
      // Auto-Close (5s default)
      const startAutoClose = (duration = 8000) => {
        if (this.autoCloseTimeout) clearTimeout(this.autoCloseTimeout);
        this.autoCloseTimeout = setTimeout(() => {
           if (document.body.contains(badge)) this.hide(badge);
        }, duration);
      };

      badge.addEventListener("mouseenter", () => {
         if (this.autoCloseTimeout) clearTimeout(this.autoCloseTimeout);
      });
      
      badge.addEventListener("mouseleave", () => {
         startAutoClose(5000); 
      });

      // Heart Spawner
      const spawnHeart = () => {
        if (!badge.isConnected) return;
        const heart = document.createElement("div");
        heart.className = "cvs-heart-float";
        heart.textContent = "❤️";
        const randomLeft = Math.floor(Math.random() * 80) + 10; 
        const randomDuration = Math.random() * 1.5 + 2; 
        const randomSize = Math.floor(Math.random() * 6) + 12;
        heart.style.left = `${randomLeft}%`;
        heart.style.fontSize = `${randomSize}px`;
        heart.style.animationDuration = `${randomDuration}s`;
        badge.appendChild(heart);
        setTimeout(() => { if (heart.isConnected) heart.remove(); }, randomDuration * 1000);
      };

      this.heartInterval = setInterval(spawnHeart, 800);
      spawnHeart();

      document.body.appendChild(badge);

      // SLIDE IN
      requestAnimationFrame(() => {
        badge.style.opacity = "1";
        badge.style.transform = "translateY(0) scale(1)";
      });

      startAutoClose();
    }

    hide(badgeElement) {
      if (this.heartInterval) clearInterval(this.heartInterval);
      if (this.autoCloseTimeout) clearTimeout(this.autoCloseTimeout);

      if (badgeElement) {
        badgeElement.style.opacity = "0";
        badgeElement.style.transform = "translateY(50px) scale(0.9)";
        setTimeout(() => {
          if (badgeElement.isConnected) badgeElement.remove();
        }, 250);
      }

      this.isVisible = false;
      // Milestones are tracked permanently for the session, do not reset lastMilestone here.
      // this.lastMilestone persists.
    }

    // Called on every stats update
    onStatsUpdate(currentTotalMessages) {
      if (currentTotalMessages < this.previousTotalMessages) {
          this.previousTotalMessages = currentTotalMessages;
      }

      if (this.previousTotalMessages === 0) {
        this.previousTotalMessages = currentTotalMessages;
        this.lastMilestone = Math.floor(currentTotalMessages / 100) * 100;
        
        // Late Trigger: Chat loaded with >50 messages
        if (currentTotalMessages >= 50 && !this.isVisible) {
             log("[DonationBadge] Late trigger: Chat loaded with large history.");
             this.show();
        }
        return;
      }

      // Check if we just crossed 50 threshold from below
      if (this.previousTotalMessages < 50 && currentTotalMessages >= 50 && !this.isVisible) {
          this.show();
      }

      // Check milestones
      const currentMilestone = Math.floor(currentTotalMessages / 100) * 100;

      if (currentMilestone > this.lastMilestone && currentMilestone >= 100) {
         this.lastMilestone = currentMilestone;
         
         const header = `High Five! ✋ ${currentMilestone}+ messages lag-free in this chat!`;
         const body = `Loving my free extension? Keep it free & fast. <u>Buy me a beer!</u> 🍻`;
         log(`[DonationBadge] Milestone reached: ${currentMilestone}. Showing nudge.`);
         this.show(body, header);
      }

      this.previousTotalMessages = currentTotalMessages;
    }

    forceHide() {
      const badge = document.querySelector(`[${BADGE_ATTRIBUTE}]`);
      if (badge) this.hide(badge);
    }
  }

  // Export
  scroller.DonationBadge = new DonationBadge();
})();
