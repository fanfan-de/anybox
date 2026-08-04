# Theme Compatibility Reference

## Tested themes with Blank slide layout

| Theme | Background on Blank | Text Color | Recommendation |
|-------|-------------------|------------|----------------|
| Slate | Dark gradient | White | RECOMMENDED for tech/professional |
| Bold Colour | Solid color | White | Good for vibrant decks |
| Basic Black | Solid black | White | High contrast, minimal |
| Black | Solid black | White | High contrast, minimal |
| Showroom | Dark textured | White | Modern feel |
| Gradient | NO background | Black | AVOID — invisible on Blank |
| Minimalist Dark | NO background | Black | AVOID — invisible on Blank |
| Minimalist Light | NO background | Black | Light theme only |
| Basic White | White | Black | Only if light theme intended |
| White | White | Black | Only if light theme intended |
| Classic White | White | Black | Only if light theme intended |

## Notes

- "NO background" means the slide appears as plain white on Blank layout despite the theme name suggesting otherwise
- Themes apply backgrounds to structured layouts (Title, Section, Statement) but NOT always to Blank
- Since we use Blank layout to avoid placeholder conflicts, only themes that apply backgrounds to Blank are reliable
- You can change themes after creating content with `set_presentation_theme(theme_name="...")`
- Theme changes preserve text content but may alter text colors and sizes
