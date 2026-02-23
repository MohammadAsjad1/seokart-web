'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { completeSetup } from '@/store/slices/authSlice';
import { showToast } from '@/lib/toast';
import { Check, Plus, X, Loader2 } from 'lucide-react';

const DEFAULT_PLAN = 'free';

export default function OnboardingPage() {
  const [domains, setDomains] = useState(['']);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dispatch = useAppDispatch();
  const { user, loading: authLoading } = useAppSelector((state) => state.auth);
  const router = useRouter();


  useEffect(() => {
    if (!authLoading && user && !user.needsSetup) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#3f3f3f]" />
      </div>
    );
  }

  // With BigCommerce: no user means open app from BigCommerce (load callback)
  useEffect(() => {
    if (!user) {
      router.replace('/load');
    }
  }, [user, router]);

  const validateDomain = (domain: string) => {
    if (!domain.trim()) {
      return 'Domain is required';
    }
    
    let cleanDomain = domain.trim().toLowerCase();
    cleanDomain = cleanDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
    cleanDomain = cleanDomain.replace(/\/$/, ''); 
    
    const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;
    if (!domainRegex.test(cleanDomain)) {
      return 'Please enter a valid domain (e.g., example.com)';
    }
    
    return null;
  };

  const handleAddDomain = () => {
    if (domains.length < 3) {
      setDomains([...domains, '']);
      setErrors({});
    }
  };

  const handleRemoveDomain = (index: number) => {
    if (domains.length > 1) {
      const newDomains = domains.filter((_, i) => i !== index);
      setDomains(newDomains);
      
      const newErrors = { ...errors };
      delete newErrors[`domain-${index}`];
      const reindexedErrors: Record<string, string> = {};
      Object.keys(newErrors).forEach(key => {
        const idx = parseInt(key.split('-')[1]);
        if (idx > index) {
          reindexedErrors[`domain-${idx - 1}`] = newErrors[key];
        } else {
          reindexedErrors[key] = newErrors[key];
        }
      });
      setErrors(reindexedErrors);
    }
  };

  const handleDomainChange = (index: number, value: string) => {
    const newDomains = [...domains];
    newDomains[index] = value;
    setDomains(newDomains);
    
    if (errors[`domain-${index}`]) {
      const newErrors = { ...errors };
      delete newErrors[`domain-${index}`];
      setErrors(newErrors);
    }
  };

  const handleProceed = async () => {
    const newErrors: Record<string, string> = {};
    let hasError = false;
    
    const validDomains: string[] = [];
    domains.forEach((domain, index) => {
      if (domain.trim()) {
        const error = validateDomain(domain);
        if (error) {
          newErrors[`domain-${index}`] = error;
          hasError = true;
        } else {
          let cleanDomain = domain.trim().toLowerCase();
          cleanDomain = cleanDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
          cleanDomain = cleanDomain.replace(/\/$/, '');
          validDomains.push(cleanDomain);
        }
      }
    });
    
    if (validDomains.length === 0) {
      newErrors['general'] = 'Please add at least one domain';
      hasError = true;
    }
    
    setErrors(newErrors);
    
    if (!hasError) {
      setIsSubmitting(true);
      try {
        await dispatch(completeSetup({ 
          plan: DEFAULT_PLAN, 
          domain: validDomains[0] 
        })).unwrap();
        
        showToast('Setup completed successfully! Welcome to your dashboard.', 'success');
        router.push('/dashboard');
      } catch (err: any) {
        console.error('Setup error:', err);
        const message = err || 'Failed to complete setup';
        setErrors({ general: message });
        showToast(message, 'error');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 w-screen">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-2xl">
        <div className="p-8">
          <div className="animate-fade-in">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-[#3f3f3f] mb-2">Welcome! Add Your Domain</h1>
              <p className="text-gray-600">
                Enter your website domain to get started
              </p>
            </div>

            {errors.general && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {errors.general}
              </div>
            )}

            <div className="space-y-4 mb-6">
              {domains.map((domain, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={domain}
                        onChange={(e) => handleDomainChange(index, e.target.value)}
                        placeholder="example.com"
                        disabled={isSubmitting}
                        className={`w-full px-4 py-3 border rounded-lg outline-none transition-all ${
                          errors[`domain-${index}`]
                            ? 'border-red-500 focus:ring-2 focus:ring-red-200'
                            : 'border-gray-300 focus:ring-2 focus:ring-[#3f3f3f] focus:border-transparent'
                        } ${isSubmitting ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                    </div>
                    {domains.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveDomain(index)}
                        disabled={isSubmitting}
                        className="p-3 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X size={20} />
                      </button>
                    )}
                  </div>
                  {errors[`domain-${index}`] && (
                    <p className="text-sm text-red-600 ml-1">{errors[`domain-${index}`]}</p>
                  )}
                </div>
              ))}

              {/* {domains.length < 3 && !isSubmitting && (
                <button
                  type="button"
                  onClick={handleAddDomain}
                  className="w-full px-4 py-3 text-[#3f3f3f] border-2 border-dashed border-gray-300 rounded-lg hover:border-[#3f3f3f] hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={18} />
                  Add More Domain (optional, max 3)
                </button>
              )} */}

              {domains.length >= 3 && (
                <p className="text-sm text-gray-600 text-center">
                  Maximum 3 domains can be added at once
                </p>
              )}
            </div>

            <div className="bg-gray-50 rounded-lg p-6 mb-6">
              <h3 className="font-semibold text-gray-900 mb-2">Your Free Plan Includes:</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <Check size={16} className="text-green-600" />
                  1 domain tracking
                </li>
                <li className="flex items-center gap-2">
                  <Check size={16} className="text-green-600" />
                  10 keywords
                </li>
                <li className="flex items-center gap-2">
                  <Check size={16} className="text-green-600" />
                  100 pages/month crawling
                </li>
                <li className="flex items-center gap-2">
                  <Check size={16} className="text-green-600" />
                  50 backlinks/month
                </li>
                <li className="flex items-center gap-2">
                  <Check size={16} className="text-green-600" />
                  Weekly updates
                </li>
              </ul>
            </div>

            <button
              onClick={handleProceed}
              disabled={isSubmitting}
              className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg transition-all ${
                isSubmitting
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-[#3f3f3f] text-white hover:bg-[#2f2f2f]'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Setting up your account...
                </>
              ) : (
                <>
                  <Check size={18} />
                  Get Started
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}