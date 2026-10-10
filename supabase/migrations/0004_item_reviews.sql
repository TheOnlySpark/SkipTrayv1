CREATE TABLE public.item_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    feedback_text TEXT,
    admin_reply TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(order_id, menu_item_id)
);

ALTER TABLE public.item_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reviews" ON public.item_reviews
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all reviews" ON public.item_reviews
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
        )
    );

CREATE POLICY "Users can insert reviews for their collected orders" ON public.item_reviews
    FOR INSERT WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = order_id AND orders.user_id = auth.uid() AND orders.status = 'COLLECTED'
        )
    );

CREATE POLICY "Users can update their own reviews" ON public.item_reviews
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can update reviews" ON public.item_reviews
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
        )
    );

CREATE POLICY "Users can delete their own reviews" ON public.item_reviews
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete reviews" ON public.item_reviews
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
        )
    );
