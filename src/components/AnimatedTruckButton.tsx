import React, { useState, useEffect } from 'react';
import './AnimatedTruckButton.css';

interface AnimatedTruckButtonProps {
  onClick: () => Promise<void> | void;
  disabled?: boolean;
  text?: string;
  className?: string;
}

const BASE_TIMINGS = {
  BOX_DROP: 500,
  TRUCK_ENTRY: 1000,
  DOORS_OPEN: 700,
  REVERSE_LOAD: 1500,
  DOORS_CLOSE: 600,
  FORWARD_START: 1000,
  LIGHTS_ON: 800,
  DRIVE_OUT: 1000,
  AUTO_RESET_DELAY: 2500
};

type AnimationStep = keyof typeof BASE_TIMINGS | 'IDLE';

export const AnimatedTruckButton: React.FC<AnimatedTruckButtonProps> = ({
  onClick,
  disabled = false,
  text = 'Place Order',
  className = ''
}) => {
  const [step, setStep] = useState<AnimationStep>('IDLE');
  const [isCompleted, setIsCompleted] = useState(false);

  const startAnimation = async () => {
    if (disabled || step !== 'IDLE') return;
    
    // Start the first step immediately so isAnimating becomes true
    setStep('BOX_DROP');

    // Trigger onClick immediately for UX responsiveness
    // We don't await it so the animation isn't delayed
    try {
      onClick();
    } catch (e) {
      console.error('Order failed', e);
      setStep('IDLE');
      return;
    }

    // Sequence of animations
    const steps: AnimationStep[] = [
      'BOX_DROP',
      'TRUCK_ENTRY',
      'DOORS_OPEN',
      'REVERSE_LOAD',
      'DOORS_CLOSE',
      'FORWARD_START',
      'LIGHTS_ON',
      'DRIVE_OUT'
    ];

    let currentDelay = 0;

    for (const currentStep of steps) {
      setTimeout(() => {
        setStep(currentStep);
      }, currentDelay);
      currentDelay += BASE_TIMINGS[currentStep];
    }

    // Completion
    setTimeout(() => {
      setIsCompleted(true);
      setStep('IDLE');
      
      // Auto reset
      setTimeout(() => {
        setIsCompleted(false);
      }, BASE_TIMINGS.AUTO_RESET_DELAY);
      
    }, currentDelay);
  };

  const isAnimating = step !== 'IDLE' && !isCompleted;

  return (
    <button
      type="button"
      className={`truck-button ${isAnimating ? 'is-animating' : ''} ${isCompleted ? 'is-completed' : ''} ${className}`}
      onClick={startAnimation}
      disabled={disabled || isAnimating}
      data-step={step}
    >
      <span className="default-text">{text}</span>
      <span className="success-text">Order Placed</span>

      <div className="truck-wrapper">
        <div className="truck-box" />
        <div className="truck">
          <div className="truck-trailer">
            <div className="door-top" />
            <div className="door-bottom" />
          </div>
          <div className="truck-cab">
            <div className="truck-lights" />
          </div>
        </div>
      </div>
    </button>
  );
};
