'use client';

interface ToggleButtonProps {
  isActive: boolean;
  onToggle: () => void | Promise<void>;
  activeText?: string;
  inactiveText?: string;
  disabled?: boolean;
}

export function ToggleButton({ 
  isActive, 
  onToggle, 
  activeText = '✓ Activé',
  inactiveText = 'Activer',
  disabled = false
}: ToggleButtonProps) {
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[ToggleButton] clicked, isActive:', isActive);
    try {
      await onToggle();
      console.log('[ToggleButton] onToggle completed');
    } catch (err) {
      console.error('[ToggleButton] onToggle error:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`px-4 py-2 rounded text-sm font-medium transition-colors select-none ${
        isActive 
          ? 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
          : 'bg-gray-600 text-gray-300 hover:bg-gray-500 active:bg-gray-400'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {isActive ? activeText : inactiveText}
    </button>
  );
}
