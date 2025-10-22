// Simple UI menus initializer for gas and solid selection
export function initMenus({ onGasChange, onSolidChange, notify }) {
  try {
    const gasSelect = document.getElementById('gasSelect');
    const closeGasMenu = document.getElementById('closeGasMenu');
    if (gasSelect) {
      gasSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        try { onGasChange && onGasChange(val); } catch {}
      });
    }
    if (closeGasMenu) {
      closeGasMenu.addEventListener('click', function() {
        const menu = document.getElementById('gasMenu');
        if (menu) menu.style.display = 'none';
      });
    }
  } catch {}

  try {
    const solidSelect = document.getElementById('solidSelect');
    const closeSolidMenu = document.getElementById('closeSolidMenu');
    if (solidSelect) {
      solidSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        try { onSolidChange && onSolidChange(val); } catch {}
      });
    }
    if (closeSolidMenu) {
      closeSolidMenu.addEventListener('click', function() {
        const menu = document.getElementById('solidMenu');
        if (menu) menu.style.display = 'none';
      });
    }
  } catch {}
}
