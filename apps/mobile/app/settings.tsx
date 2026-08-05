import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Feather from '@expo/vector-icons/Feather';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  organizationSettingsSchema,
  PAYMENT_METHODS,
  type OrganizationSettingsInput,
  type PaymentMethod,
} from '@ximo/shared';
import { AppSidebarProvider } from '@/components/app-sidebar';
import { Button, Field, Header, LoadingState, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useIosAlert } from '@/providers/ios-alert';
import { useSession } from '@/providers/session';

const CURRENCY_OPTIONS = [
  { label: 'Philippine Peso (PHP)', value: 'PHP', symbol: '₱', flag: '🇵🇭' },
  { label: 'US Dollar (USD)', value: 'USD', symbol: '$', flag: '🇺🇸' },
  { label: 'Euro (EUR)', value: 'EUR', symbol: '€', flag: '🇪🇺' },
  { label: 'Singapore Dollar (SGD)', value: 'SGD', symbol: 'S$', flag: '🇸🇬' },
  { label: 'Japanese Yen (JPY)', value: 'JPY', symbol: '¥', flag: '🇯🇵' },
];

const TIMEZONE_OPTIONS = [
  { label: 'Asia/Manila (GMT+8)', value: 'Asia/Manila' },
  { label: 'Asia/Singapore (GMT+8)', value: 'Asia/Singapore' },
  { label: 'UTC (GMT+0)', value: 'UTC' },
  { label: 'America/New_York (EST)', value: 'America/New_York' },
];

const PAYMENT_METHOD_CONFIG: Record<PaymentMethod, { label: string; icon: string; bg: string; text: string }> = {
  cash: { label: 'Cash Payment', icon: 'dollar-sign', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800' },
  card: { label: 'Credit / Debit Card', icon: 'credit-card', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-800' },
  ewallet: { label: 'E-Wallet (GCash/Maya)', icon: 'smartphone', bg: 'bg-purple-50 border-purple-200', text: 'text-purple-800' },
};

function SettingsContent() {
  const { currentUser } = useSession();
  const { showAlert } = useIosAlert();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'profile' | 'taxes' | 'inventory' | 'receipt'>('profile');

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<OrganizationSettingsInput>('/settings'),
  });

  const form = useForm<OrganizationSettingsInput>({
    resolver: zodResolver(organizationSettingsSchema),
    defaultValues: {
      businessName: '',
      currency: 'PHP',
      timezone: 'Asia/Manila',
      taxRate: '12.00',
      receiptHeader: '',
      receiptFooter: '',
      allowNegativeInventory: false,
      paymentMethods: ['cash', 'card', 'ewallet'],
      targetMarginPercent: '25.00',
      lowMarginThresholdPercent: '15.00',
    },
  });

  useEffect(() => {
    if (query.data) {
      form.reset(query.data);
    }
  }, [form, query.data]);

  const save = useMutation({
    mutationFn: (input: OrganizationSettingsInput) =>
      api('/settings', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['current-organization'] });
      showAlert({
        title: 'Settings Saved',
        message: 'Your business profile, tax rates, and checkout configuration have been updated.',
        type: 'success',
      });
    },
    onError: (error) => {
      showAlert({
        title: 'Save Failed',
        message: error.message || 'Could not update settings. Please check form entries.',
        type: 'error',
      });
    },
  });

  if (query.isLoading) {
    return (
      <Screen>
        <Header
          title="Store Settings"
          subtitle="Loading business configuration…"
          showBack
          backLabel="More"
          fallbackHref="/(tabs)/more"
        />
        <LoadingState />
      </Screen>
    );
  }

  const editable = currentUser?.permissions.includes('settings:manage') ?? false;
  const watchValues = form.watch();

  return (
    <Screen>
      <Header
        title="Store Settings"
        subtitle={editable ? 'Business profile, checkout taxes, receipt design & stock rules' : 'Read-only business configuration'}
        showBack
        backLabel="More"
        fallbackHref="/(tabs)/more"
        action={
          editable ? (
            <Button
              title={save.isPending ? 'Saving…' : 'Save Changes'}
              disabled={save.isPending}
              onPress={form.handleSubmit((value) => save.mutate(value))}
            />
          ) : null
        }
      />

      {/* Navigation Quick Tabs */}
      <View className="flex-row items-center border-b border-slate-200/80 bg-white px-4 py-2.5">
        {[
          { id: 'profile', label: 'Business Profile', icon: 'briefcase' },
          { id: 'taxes', label: 'Pricing & Taxes', icon: 'dollar-sign' },
          { id: 'inventory', label: 'Inventory & Payments', icon: 'sliders' },
          { id: 'receipt', label: 'Receipt Template', icon: 'printer' },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              onPress={() => setActiveTab(tab.id as any)}
              className={`mr-2 flex-row items-center rounded-xl px-3 py-2 transition-all ${
                isActive ? 'bg-emerald-800' : 'bg-slate-100 active:bg-slate-200'
              }`}
            >
              <Feather name={tab.icon as any} size={14} color={isActive ? '#FFFFFF' : '#475569'} />
              <Text className={`ml-1.5 text-xs font-bold ${isActive ? 'text-white' : 'text-slate-700'}`}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerClassName="p-4 pb-20 max-w-5xl mx-auto w-full gap-5">
        {/* SECTION 1: BUSINESS IDENTITY */}
        {activeTab === 'profile' && (
          <View className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <View className="mb-4 flex-row items-center gap-3 border-b border-slate-100 pb-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-200">
                <Feather name="briefcase" size={20} color="#065F46" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-bold text-slate-900">Business Identity & Locale</Text>
                <Text className="text-xs text-slate-500">Official business name, default currency, and regional timezone</Text>
              </View>
            </View>

            <View className="gap-4">
              <Controller
                control={form.control}
                name="businessName"
                render={({ field, fieldState }) => (
                  <Field
                    label="Official Business Name"
                    value={field.value}
                    editable={editable}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="e.g. Ximo Headquarter Store"
                    error={fieldState.error?.message}
                  />
                )}
              />

              {/* Currency Selector */}
              <View>
                <Text className="mb-1.5 text-xs font-bold tracking-wide text-slate-700">Operating Currency</Text>
                <Controller
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <View className="flex-row flex-wrap gap-2">
                      {CURRENCY_OPTIONS.map((c) => {
                        const isSelected = field.value === c.value;
                        return (
                          <Pressable
                            key={c.value}
                            disabled={!editable}
                            onPress={() => field.onChange(c.value)}
                            className={`flex-row items-center rounded-xl border px-3 py-2.5 transition-all ${
                              isSelected
                                ? 'border-emerald-600 bg-emerald-50/90 shadow-2xs'
                                : 'border-slate-200 bg-white active:bg-slate-50'
                            }`}
                          >
                            <Text className="mr-1.5 text-sm">{c.flag}</Text>
                            <Text className={`text-xs font-bold ${isSelected ? 'text-emerald-900' : 'text-slate-700'}`}>
                              {c.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                />
              </View>

              {/* Timezone Selector */}
              <View className="mt-1">
                <Text className="mb-1.5 text-xs font-bold tracking-wide text-slate-700">Timezone Location</Text>
                <Controller
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <View className="flex-row flex-wrap gap-2">
                      {TIMEZONE_OPTIONS.map((tz) => {
                        const isSelected = field.value === tz.value;
                        return (
                          <Pressable
                            key={tz.value}
                            disabled={!editable}
                            onPress={() => field.onChange(tz.value)}
                            className={`rounded-xl border px-3 py-2 transition-all ${
                              isSelected
                                ? 'border-emerald-600 bg-emerald-50/90 shadow-2xs'
                                : 'border-slate-200 bg-white active:bg-slate-50'
                            }`}
                          >
                            <Text className={`text-xs font-bold ${isSelected ? 'text-emerald-900' : 'text-slate-700'}`}>
                              {tz.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                />
              </View>
            </View>
          </View>
        )}

        {/* SECTION 2: PRICING & TAXES */}
        {activeTab === 'taxes' && (
          <View className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <View className="mb-4 flex-row items-center gap-3 border-b border-slate-100 pb-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-blue-50 border border-blue-200">
                <Feather name="percent" size={20} color="#1E40AF" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-bold text-slate-900">Pricing, Taxes & Gross Margins</Text>
                <Text className="text-xs text-slate-500">Set checkout Value-Added Tax (VAT) and target profit margin thresholds</Text>
              </View>
            </View>

            <View className="gap-4">
              <Controller
                control={form.control}
                name="taxRate"
                render={({ field, fieldState }) => (
                  <View>
                    <Field
                      label="Default Value-Added Tax Rate (%)"
                      value={field.value}
                      editable={editable}
                      keyboardType="numeric"
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                      error={fieldState.error?.message}
                    />
                    <Text className="mt-1 text-[11px] text-slate-500">
                      Standard VAT in the Philippines is 12.00%. Enter 0.00 if tax-exempt.
                    </Text>
                  </View>
                )}
              />

              <View className="flex-row flex-wrap gap-4">
                <View className="flex-1 min-w-[200px]">
                  <Controller
                    control={form.control}
                    name="targetMarginPercent"
                    render={({ field, fieldState }) => (
                      <Field
                        label="Target Gross Margin (%)"
                        value={field.value}
                        editable={editable}
                        keyboardType="numeric"
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                      />
                    )}
                  />
                  <Text className="mt-1 text-[11px] text-slate-500">Recommended target for retail and food service: 25.00%</Text>
                </View>

                <View className="flex-1 min-w-[200px]">
                  <Controller
                    control={form.control}
                    name="lowMarginThresholdPercent"
                    render={({ field, fieldState }) => (
                      <Field
                        label="Low-Margin Alert Threshold (%)"
                        value={field.value}
                        editable={editable}
                        keyboardType="numeric"
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                      />
                    )}
                  />
                  <Text className="mt-1 text-[11px] text-slate-500">Warns staff when selling items below this margin level</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* SECTION 3: INVENTORY & PAYMENTS */}
        {activeTab === 'inventory' && (
          <View className="gap-5">
            {/* Negative Inventory Toggle */}
            <View className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
              <View className="mb-4 flex-row items-center gap-3 border-b border-slate-100 pb-3">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-amber-50 border border-amber-200">
                  <Feather name="layers" size={20} color="#92400E" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-slate-900">Inventory Policy & Overselling</Text>
                  <Text className="text-xs text-slate-500">Control stock enforcement rules at checkout</Text>
                </View>
              </View>

              <Controller
                control={form.control}
                name="allowNegativeInventory"
                render={({ field }) => (
                  <View className="flex-row items-center justify-between rounded-xl bg-amber-50/60 p-4 border border-amber-200/70">
                    <View className="flex-1 pr-4">
                      <View className="flex-row items-center gap-2">
                        <Feather name="alert-triangle" size={16} color="#B45309" />
                        <Text className="text-sm font-bold text-slate-900">Allow Negative Inventory</Text>
                      </View>
                      <Text className="mt-1 text-xs text-slate-600 leading-relaxed">
                        When enabled, cashiers can complete sales even if recorded stock is zero. Disable this to prevent selling items out of stock.
                      </Text>
                    </View>
                    <Switch
                      disabled={!editable}
                      value={field.value}
                      onValueChange={field.onChange}
                      trackColor={{ false: '#CBD5E1', true: '#059669' }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                )}
              />
            </View>

            {/* Allowed Payment Methods */}
            <View className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
              <View className="mb-4 flex-row items-center gap-3 border-b border-slate-100 pb-3">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-purple-50 border border-purple-200">
                  <Feather name="credit-card" size={20} color="#6B21A8" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-slate-900">Checkout Payment Methods</Text>
                  <Text className="text-xs text-slate-500">Select payment channels available to cashiers at checkout</Text>
                </View>
              </View>

              <Controller
                control={form.control}
                name="paymentMethods"
                render={({ field }) => {
                  const currentMethods = field.value || [];
                  return (
                    <View className="gap-3">
                      {PAYMENT_METHODS.map((method) => {
                        const cfg = PAYMENT_METHOD_CONFIG[method];
                        const isChecked = currentMethods.includes(method);

                        const toggleMethod = () => {
                          if (!editable) return;
                          if (isChecked) {
                            if (currentMethods.length <= 1) {
                              showAlert({
                                title: 'Payment Required',
                                message: 'At least one payment method must remain enabled for POS checkout.',
                                type: 'warning',
                              });
                              return;
                            }
                            field.onChange(currentMethods.filter((m) => m !== method));
                          } else {
                            field.onChange([...currentMethods, method]);
                          }
                        };

                        return (
                          <Pressable
                            key={method}
                            disabled={!editable}
                            onPress={toggleMethod}
                            className={`flex-row items-center justify-between rounded-xl border p-3.5 transition-all ${
                              isChecked ? cfg.bg : 'border-slate-200 bg-white active:bg-slate-50'
                            }`}
                          >
                            <View className="flex-row items-center gap-3">
                              <View className={`h-8 w-8 items-center justify-center rounded-lg ${isChecked ? 'bg-white shadow-2xs' : 'bg-slate-100'}`}>
                                <Feather name={cfg.icon as any} size={16} color={isChecked ? '#0F172A' : '#64748B'} />
                              </View>
                              <Text className={`text-sm font-bold ${isChecked ? cfg.text : 'text-slate-700'}`}>
                                {cfg.label}
                              </Text>
                            </View>

                            <View className={`h-6 w-6 items-center justify-center rounded-md border ${isChecked ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 bg-white'}`}>
                              {isChecked ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                }}
              />
            </View>
          </View>
        )}

        {/* SECTION 4: RECEIPT DESIGN & PREVIEW */}
        {activeTab === 'receipt' && (
          <View className="gap-5">
            <View className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
              <View className="mb-4 flex-row items-center gap-3 border-b border-slate-100 pb-3">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-teal-50 border border-teal-200">
                  <Feather name="printer" size={20} color="#115E59" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-slate-900">Thermal Receipt Header & Footer</Text>
                  <Text className="text-xs text-slate-500">Custom message printed at the top and bottom of customer receipts</Text>
                </View>
              </View>

              <View className="gap-4">
                <Controller
                  control={form.control}
                  name="receiptHeader"
                  render={({ field, fieldState }) => (
                    <Field
                      label="Receipt Header Announcement"
                      value={field.value}
                      editable={editable}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="e.g. Welcome to Ximo POS! Thank you for shopping with us."
                      error={fieldState.error?.message}
                    />
                  )}
                />

                <Controller
                  control={form.control}
                  name="receiptFooter"
                  render={({ field, fieldState }) => (
                    <Field
                      label="Receipt Footer Policy / Greeting"
                      value={field.value}
                      editable={editable}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="e.g. Please retain this receipt for return or exchange within 7 days."
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </View>
            </View>

            {/* Simulated Printed Receipt Live Preview */}
            <View className="rounded-2xl border border-dashed border-slate-300 bg-slate-100 p-5">
              <Text className="mb-3 text-center text-xs font-bold uppercase tracking-widest text-slate-500">
                🧾 Thermal Receipt Live Print Preview
              </Text>

              <View className="mx-auto max-w-sm w-full rounded-lg bg-white p-4 shadow-sm border border-slate-200 font-mono">
                {/* Header */}
                <Text className="text-center font-bold text-slate-900 text-sm">
                  {watchValues.businessName || 'XIMO POS STORE'}
                </Text>
                <Text className="mt-1 text-center text-[11px] text-slate-600 italic">
                  {watchValues.receiptHeader || 'Welcome! Thank you for shopping.'}
                </Text>

                <View className="my-3 border-b border-dashed border-slate-300" />

                {/* Items Sample */}
                <View className="gap-1">
                  <View className="flex-row justify-between text-xs text-slate-800">
                    <Text className="text-xs font-mono text-slate-700">1x Bottled Water 500ml</Text>
                    <Text className="text-xs font-mono font-bold text-slate-900">₱25.00</Text>
                  </View>
                  <View className="flex-row justify-between text-xs text-slate-800">
                    <Text className="text-xs font-mono text-slate-700">2x Brown Sugar 1kg</Text>
                    <Text className="text-xs font-mono font-bold text-slate-900">₱110.00</Text>
                  </View>
                </View>

                <View className="my-3 border-b border-dashed border-slate-300" />

                {/* Totals */}
                <View className="gap-1">
                  <View className="flex-row justify-between">
                    <Text className="text-xs font-mono text-slate-500">Subtotal</Text>
                    <Text className="text-xs font-mono text-slate-700">₱135.00</Text>
                  </View>
                  <View className="flex-row justify-between">
                    <Text className="text-xs font-mono text-slate-500">VAT ({watchValues.taxRate || '12.00'}%)</Text>
                    <Text className="text-xs font-mono text-slate-700">₱16.20</Text>
                  </View>
                  <View className="mt-1 flex-row justify-between border-t border-slate-200 pt-1">
                    <Text className="text-sm font-mono font-bold text-slate-900">TOTAL</Text>
                    <Text className="text-sm font-mono font-bold text-emerald-800">₱151.20</Text>
                  </View>
                </View>

                <View className="my-3 border-b border-dashed border-slate-300" />

                {/* Footer */}
                <Text className="text-center text-[11px] text-slate-600 italic leading-tight">
                  {watchValues.receiptFooter || 'Please retain receipt for 7-day exchange.'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Floating Bottom Save Action Bar */}
        {editable ? (
          <View className="mt-4 flex-row items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <View className="flex-1 pr-3">
              <Text className="text-xs font-bold text-slate-900">Unsaved Business Configuration</Text>
              <Text className="text-[11px] text-slate-500">Changes will take effect immediately across all POS registers.</Text>
            </View>
            <Button
              title={save.isPending ? 'Saving…' : 'Save Settings'}
              disabled={save.isPending}
              onPress={form.handleSubmit((value) => save.mutate(value))}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function SettingsScreen() {
  return (
    <AppSidebarProvider>
      <SettingsContent />
    </AppSidebarProvider>
  );
}
