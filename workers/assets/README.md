# Persona assets

`profile_setup` uploads one avatar and one cover per persona from here:

```
assets/<persona_type>/avatar.jpg     (or .jpeg / .png / .webp)
assets/<persona_type>/cover.jpg
```

`<persona_type>` is the value on the account (`me_bim`, `decor`, `tech`, ...).

Rules that matter:

- **Real photos only.** A generated face is both obviously fake and indefensible if
  the platform asks who the person is.
- **Use them elsewhere too.** The same picture should appear on the account's own
  posts, otherwise the profile has one photo and thirty posts without any.
- **One persona, one look.** Two accounts sharing an avatar are trivially linked,
  which defeats the point of separate proxies.
- Images are read from disk and never uploaded anywhere except the platform.

The `.png` files currently in this folder are solid-colour placeholders used to
verify the upload path. Replace them.
