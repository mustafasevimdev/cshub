# Supabase Setup (CsHub)

1. Supabase Dashboard'da projeni ac.
2. `SQL Editor` ekranina gir.
3. `supabase/schema.sql` dosyasinin icerigini yapistirip calistir.
4. Uygulamayi yeniden baslat.

Gerekli env:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Not:
- `Could not find the table 'public.channels'` hatasi alirsan schema SQL'i calismamistir.
