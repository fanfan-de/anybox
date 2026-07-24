import React from "react"
import { ActivityIndicator, Pressable, Text } from "react-native"
import { theme } from "@/theme"

interface ButtonProps {
  label: string
  onPress: () => void
  accessibilityLabel?: string
  disabled?: boolean
  loading?: boolean
  variant?: "primary" | "secondary" | "danger"
}

const buttonVariantStyles = {
  primary: {
    backgroundColor: theme.colors.actionPrimary,
    color: theme.colors.textInverted,
  },
  secondary: {
    backgroundColor: theme.colors.actionSecondary,
    color: theme.colors.text,
  },
  danger: {
    backgroundColor: theme.colors.actionDanger,
    color: theme.colors.textInverted,
  },
} as const

export function Button({
  label,
  onPress,
  accessibilityLabel,
  disabled,
  loading,
  variant = "primary",
}: ButtonProps) {
  const isDisabled = disabled || loading
  const variantStyle = buttonVariantStyles[variant]

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: variantStyle.backgroundColor,
        borderRadius: theme.radius.sm,
        flexDirection: "row",
        gap: theme.spacing.md,
        justifyContent: "center",
        minHeight: 46,
        opacity: isDisabled ? theme.opacity.disabled : pressed ? theme.opacity.pressedStrong : 1,
        paddingHorizontal: theme.spacing.screen,
        paddingVertical: theme.spacing.xl,
      })}
    >
      {loading ? <ActivityIndicator color={variantStyle.color} /> : null}
      <Text
        style={{
          color: variantStyle.color,
          fontSize: theme.typography.size.lg,
          fontWeight: theme.typography.weight.bold,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}
