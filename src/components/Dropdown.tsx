import React, { useState, useRef, useEffect, useId } from 'react';
import { ChevronDown, Check, Search, X, AlertCircle } from 'lucide-react';

export interface DropdownOption<T = string | number> {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  disabled?: boolean;
}

export type DropdownSize = 'sm' | 'md' | 'lg';

export interface DropdownProps<T = string | number> {
  options: DropdownOption<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T | undefined, option?: DropdownOption<T>) => void;
  placeholder?: string;
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: string | boolean;
  required?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  clearable?: boolean;
  size?: DropdownSize;
  fullWidth?: boolean;
  className?: string;
  containerClassName?: string;
}

export function Dropdown<T extends string | number = string>({
  options,
  value,
  defaultValue,
  onChange,
  placeholder = 'Select an option...',
  label,
  helperText,
  error,
  required = false,
  disabled = false,
  searchable = false,
  clearable = false,
  size = 'md',
  fullWidth = true,
  className = '',
  containerClassName = ''
}: DropdownProps<T>) {
  const generatedId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [internalValue, setInternalValue] = useState<T | undefined>(defaultValue);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsListRef = useRef<HTMLUListElement>(null);

  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : internalValue;

  // Find currently selected option
  const selectedOption = options.find(opt => opt.value === selectedValue);

  // Filter options based on search query
  const filteredOptions = searchQuery.trim()
    ? options.filter(opt =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (opt.description && opt.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : options;

  // Handle outside click to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setFocusedIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen, searchable]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery('');
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          const target = filteredOptions[focusedIndex];
          if (!target.disabled) {
            handleSelect(target);
          }
        }
        break;
    }
  };

  const handleSelect = (option: DropdownOption<T>) => {
    if (option.disabled) return;
    if (!isControlled) {
      setInternalValue(option.value);
    }
    onChange?.(option.value, option);
    setIsOpen(false);
    setSearchQuery('');
    setFocusedIndex(-1);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isControlled) {
      setInternalValue(undefined);
    }
    onChange?.(undefined, undefined);
  };

  const isError = Boolean(error);
  const errorMessage = typeof error === 'string' ? error : undefined;

  // Size configurations
  const sizeStyles: Record<DropdownSize, { trigger: string; text: string; icon: number }> = {
    sm: { trigger: 'py-1.5 px-3 text-xs rounded-lg min-h-[34px]', text: 'text-xs', icon: 14 },
    md: { trigger: 'py-2.5 px-3.5 text-sm rounded-xl min-h-[42px]', text: 'text-sm', icon: 16 },
    lg: { trigger: 'py-3 px-4 text-base rounded-xl min-h-[50px]', text: 'text-base', icon: 18 }
  };

  return (
    <div
      ref={containerRef}
      className={`relative ${fullWidth ? 'w-full' : 'inline-block min-w-[200px]'} ${containerClassName}`}
      onKeyDown={handleKeyDown}
    >
      {/* Label */}
      {label && (
        <label
          id={`${generatedId}-label`}
          className={`block font-semibold text-slate-700 mb-1.5 ${sizeStyles[size].text}`}
        >
          {label}
          {required && <span className="text-rose-500 ml-1 font-bold">*</span>}
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        id={`${generatedId}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby={label ? `${generatedId}-label ${generatedId}-trigger` : undefined}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setIsOpen(prev => !prev);
        }}
        className={`
          w-full flex items-center justify-between gap-2.5 bg-white border text-left font-normal transition-all duration-200 outline-hidden
          ${sizeStyles[size].trigger}
          ${isError
            ? 'border-rose-400 focus:border-rose-600 focus:outline-none bg-rose-50/10'
            : isOpen
            ? 'border-indigo-600 focus:outline-none'
            : 'border-slate-300 hover:border-slate-400 focus:border-indigo-600 focus:outline-none'
          }
          ${disabled ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed select-none' : 'cursor-pointer shadow-2xs'}
          ${className}
        `}
      >
        {/* Selected Value Content */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {selectedOption?.icon && (
            <span className="shrink-0 text-slate-500">{selectedOption.icon}</span>
          )}

          {selectedOption ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-slate-800 font-medium truncate">
                {selectedOption.label}
              </span>
              {selectedOption.badge && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0 ${
                  selectedOption.badgeColor || 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  {selectedOption.badge}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400 truncate">{placeholder}</span>
          )}
        </div>

        {/* Right Action Icons: Clear & Chevron */}
        <div className="flex items-center gap-1.5 shrink-0 text-slate-400">
          {clearable && selectedOption && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              className="p-1 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
              title="Clear selection"
              aria-label="Clear selection"
            >
              <X size={14} />
            </span>
          )}

          <ChevronDown
            size={sizeStyles[size].icon}
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-600' : ''}`}
          />
        </div>
      </button>

      {/* Dropdown Menu Popover */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150 max-h-72 flex flex-col">
          {/* Search Input Box */}
          {searchable && (
            <div className="px-3 pt-1.5 pb-2 border-b border-slate-100 shrink-0">
              <div className="relative flex items-center">
                <Search size={14} className="absolute left-2.5 text-slate-400 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search options..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs outline-none focus:outline-none focus:border-indigo-600 text-slate-800"
                />
              </div>
            </div>
          )}

          {/* Options List */}
          <ul
            ref={optionsListRef}
            role="listbox"
            tabIndex={-1}
            className="overflow-y-auto custom-scrollbar p-1.5 space-y-0.5 flex-1"
          >
            {filteredOptions.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-slate-400">
                No matching options found
              </li>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.value === selectedValue;
                const isFocused = idx === focusedIndex;

                return (
                  <li
                    key={String(opt.value)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled}
                    onClick={() => handleSelect(opt)}
                    onMouseEnter={() => setFocusedIndex(idx)}
                    className={`
                      flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-xs sm:text-sm transition-colors cursor-pointer select-none
                      ${isSelected
                        ? 'bg-indigo-50 text-indigo-700 font-semibold'
                        : isFocused
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                      }
                      ${opt.disabled ? 'opacity-40 pointer-events-none cursor-not-allowed' : ''}
                    `}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {opt.icon && (
                        <span className={`shrink-0 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`}>
                          {opt.icon}
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{opt.label}</span>
                          {opt.badge && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                              opt.badgeColor || 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}>
                              {opt.badge}
                            </span>
                          )}
                        </div>
                        {opt.description && (
                          <div className="text-[11px] text-slate-400 font-normal truncate mt-0.5">
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <Check size={16} className="text-indigo-600 shrink-0 ml-2" />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}

      {/* Error or Helper Message */}
      {errorMessage && (
        <p className="mt-1.5 text-xs text-rose-600 font-medium flex items-center gap-1">
          <AlertCircle size={13} className="shrink-0" />
          <span>{errorMessage}</span>
        </p>
      )}

      {!errorMessage && helperText && (
        <p className="mt-1.5 text-xs text-slate-500">
          {helperText}
        </p>
      )}
    </div>
  );
}

export const Select = Dropdown;
export default Dropdown;
