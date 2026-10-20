<?php

declare(strict_types=1);
?><!doctype html>
<html <?php language_attributes(); ?>>
<head><meta charset="<?php bloginfo('charset'); ?>"><meta name="viewport" content="width=device-width,initial-scale=1"><?php wp_head(); ?><link rel="stylesheet" href="<?php echo esc_url(get_stylesheet_uri()); ?>"></head>
<body <?php body_class(); ?>><?php wp_body_open(); ?><header>PageSquire public fixture</header>
<main id="content" data-pagesquire-content><?php while (have_posts()) {
    the_post(); ?><h1><?php the_title(); ?></h1><?php the_content();
} ?></main>
<?php wp_footer(); ?></body></html>
