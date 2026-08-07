import React, { createContext, useContext, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

export type AlertType = 'success' | 'error' | 'warning' | 'info';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface AlertOptions {
  title: string;
  message?: string;
  type?: AlertType;
  buttons?: AlertButton[];
}

interface IosAlertContextType {
  showAlert: (options: AlertOptions) => void;
  hideAlert: () => void;
}

const IosAlertContext = createContext<IosAlertContextType | undefined>(undefined);

export function IosAlertProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<AlertOptions | null>(null);

  const showAlert = (opts: AlertOptions) => {
    setOptions(opts);
    setVisible(true);
  };

  const hideAlert = () => {
    setVisible(false);
    setOptions(null);
  };

  const handleButtonPress = (btn?: AlertButton) => {
    hideAlert();
    if (btn?.onPress) {
      btn.onPress();
    }
  };

  const type = options?.type ?? 'info';
  const buttons = options?.buttons && options.buttons.length > 0
    ? options.buttons
    : [{ text: 'OK', style: 'default' as const }];

  const iconDetails = {
    success: { name: 'check-circle' as const, bg: 'bg-emerald-100', color: '#059669' },
    error: { name: 'alert-circle' as const, bg: 'bg-rose-100', color: '#E11D48' },
    warning: { name: 'alert-triangle' as const, bg: 'bg-amber-100', color: '#D97706' },
    info: { name: 'info' as const, bg: 'bg-brand-100', color: '#1A593B' },
  }[type];

  return (
    <IosAlertContext.Provider value={{ showAlert, hideAlert }}>
      {children}

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={hideAlert}
      >
        <View
          style={[
            StyleSheet.absoluteFillObject,
            Platform.OS === 'web'
              ? ({ zIndex: 2_000_000, position: 'fixed' } as object)
              : { zIndex: 2_000_000, elevation: 2_000_000 },
          ]}
          className="items-center justify-center bg-black/45 p-5"
        >
          {/* iOS Alert Card Container */}
          <View className="w-full max-w-[310px] overflow-hidden rounded-[24px] bg-white/95 backdrop-blur-xl shadow-2xl border border-slate-100/50">
            {/* Header Icon & Text Content */}
            <View className="items-center px-6 pt-6 pb-5">
              <View className={`mb-3 h-12 w-12 items-center justify-center rounded-2xl ${iconDetails.bg}`}>
                <Feather name={iconDetails.name} size={24} color={iconDetails.color} />
              </View>

              <Text className="text-center text-[17px] font-bold tracking-tight text-slate-900 leading-6">
                {options?.title}
              </Text>

              {options?.message ? (
                <Text className="mt-1.5 text-center text-[13px] font-normal leading-4 text-slate-600">
                  {options.message}
                </Text>
              ) : null}
            </View>

            {/* iOS Action Buttons Divider */}
            <View className="border-t border-slate-200/80" />

            {/* iOS Action Buttons Container */}
            <View className={buttons.length === 2 ? 'flex-row' : 'flex-col'}>
              {buttons.map((btn, index) => {
                const isDestructive = btn.style === 'destructive';
                const isCancel = btn.style === 'cancel';
                const isLast = index === buttons.length - 1;

                return (
                  <Pressable
                    key={index}
                    accessibilityRole="button"
                    onPress={() => handleButtonPress(btn)}
                    className={`min-h-[48px] flex-1 items-center justify-center px-4 py-3 active:bg-slate-100/80 ${
                      buttons.length === 2 && index === 0 ? 'border-r border-slate-200/80' : ''
                    } ${buttons.length > 2 && !isLast ? 'border-b border-slate-200/80' : ''}`}
                  >
                    <Text
                      className={`text-[17px] tracking-tight ${
                        isDestructive
                          ? 'font-bold text-rose-600'
                          : isCancel
                            ? 'font-normal text-slate-500'
                            : 'font-semibold text-brand-700'
                      }`}
                    >
                      {btn.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </IosAlertContext.Provider>
  );
}

export function useIosAlert() {
  const context = useContext(IosAlertContext);
  if (!context) {
    throw new Error('useIosAlert must be used within an IosAlertProvider');
  }
  return context;
}
