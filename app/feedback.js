import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '../src/components/ui/Icon';
import FadeInView from '../src/components/ui/FadeInView';
import haptics from '../src/lib/haptics';
import { useTheme } from '../src/theme/ThemeContext';
import { useT } from '../src/i18n/LanguageContext';
import { submitFeedback } from '../src/api/main';
import { reportError } from '../src/lib/observability';
import { space, type, radius, FONT } from '../src/theme/tokens';

/* App feedback — two fields, both optional on their own.
 *
 * Stars say how bad it is, words say why, and demanding both suppresses
 * answers: a driver at a fuel stop will tap five stars and nothing else, and
 * that is still worth having. What the screen will not do is submit nothing,
 * so Send stays disabled until one of the two exists. The server enforces the
 * same rule, because a client is not a place to keep a data rule.
 *
 * A rating is also clearable — tapping the star you already chose removes it.
 * Without that, a mis-tap is permanent for the life of the screen and the only
 * way out is to leave and come back.
 */

const STARS = [1, 2, 3, 4, 5];
const MAX_COMMENT = 4000;

export default function FeedbackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const canSend = (rating > 0 || comment.trim().length > 0) && !sending;

  const pickStar = (n) => {
    haptics.tap();
    setError(null);
    // Tapping the current rating clears it — see the note above.
    setRating((prev) => (prev === n ? 0 : n));
  };

  const send = useCallback(async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await submitFeedback({ rating, comment });
      haptics.success();
      setSent(true);
    } catch (err) {
      reportError(err, { where: 'submitFeedback' });
      haptics.error();
      // The text stays on screen on purpose. Losing what someone just wrote
      // because the truck drove through a dead zone is how you never hear
      // from them again.
      setError(t('feedback.failed'));
      setSending(false);
    }
  }, [canSend, rating, comment, t]);

  if (sent) {
    return (
      <View style={[styles.screen, styles.thanks, { paddingTop: insets.top }]}>
        <FadeInView>
          <View style={styles.thanksInner}>
            <Icon name="check-circle" size={44} color={colors.go} />
            <Text style={[styles.thanksTitle, { color: colors.textPrimary }]}>
              {t('feedback.thanksTitle')}
            </Text>
            <Text style={[styles.thanksBody, { color: colors.textSecondary }]}>
              {t('feedback.thanksBody')}
            </Text>
            <Pressable
              onPress={() => { haptics.press(); router.back(); }}
              style={[styles.doneBtn, { backgroundColor: colors.teal }]}
              accessibilityRole="button"
            >
              <Text style={[styles.doneText, { color: colors.textInverse }]}>
                {t('common.done')}
              </Text>
            </Pressable>
          </View>
        </FadeInView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => { haptics.tap(); router.back(); }}
          hitSlop={8}
          style={styles.headerBack}
          accessibilityRole="button"
        >
          <Icon name="chevron-left" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          {t('feedback.title')}
        </Text>
        <View style={styles.headerBack} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space[6] }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeInView delay={0}>
          <Text style={[styles.intro, { color: colors.textSecondary }]}>
            {t('feedback.intro')}
          </Text>
        </FadeInView>

        {/* Stars — optional */}
        <FadeInView delay={80}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.textMuted }]}>
              {t('feedback.ratingLabel')}
            </Text>
            <View style={styles.stars}>
              {STARS.map((n) => (
                <Pressable
                  key={n}
                  onPress={() => pickStar(n)}
                  hitSlop={6}
                  style={styles.star}
                  accessibilityRole="button"
                  accessibilityLabel={t('feedback.starA11y', { n })}
                  accessibilityState={{ selected: rating >= n }}
                >
                  <Icon
                    name="star"
                    family="material-community"
                    size={38}
                    color={rating >= n ? colors.caution : colors.borderStrong}
                  />
                </Pressable>
              ))}
            </View>
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {rating > 0 ? t('feedback.ratingClearHint') : t('feedback.optional')}
            </Text>
          </View>
        </FadeInView>

        {/* Text — optional */}
        <FadeInView delay={140}>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.textMuted }]}>
              {t('feedback.commentLabel')}
            </Text>
            <TextInput
              value={comment}
              onChangeText={(v) => { setComment(v); setError(null); }}
              placeholder={t('feedback.commentPlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
              maxLength={MAX_COMMENT}
              editable={!sending}
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]}
              accessibilityLabel={t('feedback.commentLabel')}
            />
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {t('feedback.optional')}
            </Text>
          </View>
        </FadeInView>

        {error ? (
          <View style={[styles.error, { backgroundColor: colors.dangerFill, borderColor: colors.danger + '55' }]}>
            <Icon name="alert-triangle" size={16} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          </View>
        ) : null}

        <FadeInView delay={200}>
          <Pressable
            onPress={send}
            disabled={!canSend}
            style={[
              styles.send,
              { backgroundColor: canSend ? colors.teal : colors.surface2,
                borderColor: canSend ? colors.teal : colors.border },
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
          >
            {sending
              ? <ActivityIndicator color={colors.textInverse} />
              : (
                <Text style={[styles.sendText, { color: canSend ? colors.textInverse : colors.textMuted }]}>
                  {t('feedback.send')}
                </Text>
              )}
          </Pressable>
          {/* Says why the button is dead, instead of leaving it a mystery. */}
          {!canSend && !sending ? (
            <Text style={[styles.sendHint, { color: colors.textMuted }]}>
              {t('feedback.needSomething')}
            </Text>
          ) : null}
        </FadeInView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[4], paddingBottom: space[3],
  },
  headerBack: { minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: FONT.bold },

  body: { paddingHorizontal: space[4], gap: space[4] },
  intro: { fontSize: 15, lineHeight: 22, fontFamily: FONT.regular },

  card: { borderRadius: radius.lg, borderWidth: 1, padding: space[4], gap: space[3] },
  label: { fontSize: 12, fontFamily: FONT.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  hint: { fontSize: 12, fontFamily: FONT.regular },

  stars: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[1] },
  star: { padding: space[1] },

  input: {
    minHeight: 120, borderWidth: 1, borderRadius: radius.md,
    padding: space[3], fontSize: 15, lineHeight: 21, fontFamily: FONT.regular,
  },

  error: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    padding: space[3], borderRadius: radius.md, borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: FONT.medium },

  send: {
    height: 64, borderRadius: radius.lg, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  sendText: { fontSize: 17, fontFamily: FONT.bold },
  sendHint: { fontSize: 12, fontFamily: FONT.regular, textAlign: 'center', marginTop: space[2] },

  thanks: { alignItems: 'center', justifyContent: 'center' },
  thanksInner: { alignItems: 'center', gap: space[3], paddingHorizontal: space[6] },
  thanksTitle: { ...type.h2, textAlign: 'center' },
  thanksBody: { fontSize: 15, lineHeight: 22, fontFamily: FONT.regular, textAlign: 'center' },
  doneBtn: {
    height: 56, minWidth: 180, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', marginTop: space[3],
  },
  doneText: { fontSize: 16, fontFamily: FONT.bold },
});
