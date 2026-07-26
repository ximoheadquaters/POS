insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "tenant product images are readable"
on storage.objects for select
using (bucket_id = 'product-images');

-- Writes are intentionally server-only through the service role. Object paths are:
-- {organization_id}/products/{product_id}/{uuid}.{extension}
