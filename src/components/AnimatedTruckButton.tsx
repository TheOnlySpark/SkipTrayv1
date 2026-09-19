import React, { useState, useEffect } from 'react';
import './AnimatedTruckButton.css';

interface AnimatedTruckButtonProps {
  onClick: () => Promise<void> | void;
  disabled?: boolean;
  text?: string;
  className?: string;
}

const BASE_TIMINGS = {
  BOX_DROP: 250,
  TRUCK_ENTRY: 500,
  DOORS_OPEN: 350,
  REVERSE_LOAD: 750,
  DOORS_CLOSE: 300,
  FORWARD_START: 500,
  LIGHTS_ON: 400,
  DRIVE_OUT: 500,
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
    
    // Trigger onClick immediately for UX responsiveness, or you can await it
    // depending on requirements.
    try {
      await onClick();
    } catch (e) {
      // If error, cancel animation
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
