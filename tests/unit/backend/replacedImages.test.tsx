import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { recordImageRename, recordImageReplace, resetReplacedImages, resolveReplacedImage, useImageSrc } from '@/components/backend/replacedImages';

function Thumb({ path }: { path: string }) {
  const imageSrc = useImageSrc();
  return <img alt="thumb" src={imageSrc(path)} />;
}

describe('replacedImages', () => {
  beforeEach(() => resetReplacedImages());

  it('leaves paths that were never replaced untouched', () => {
    expect(resolveReplacedImage('/images/a.png')).toEqual({ path: '/images/a.png', version: null });
  });

  it('maps a replaced path to its new file and version, with or without leading slash', () => {
    recordImageReplace('Logos/a.png', 'Logos/a.jpg', 5);
    expect(resolveReplacedImage('/images/Logos/a.png')).toEqual({ path: '/images/Logos/a.jpg', version: 5 });
    expect(resolveReplacedImage('images/Logos/a.jpg')).toEqual({ path: '/images/Logos/a.jpg', version: 5 });
  });

  it('follows a chain of replaces to the latest file', () => {
    recordImageReplace('a.png', 'a.jpg', 1);
    recordImageReplace('a.jpg', 'a.webp', 2);
    expect(resolveReplacedImage('/images/a.png')).toEqual({ path: '/images/a.webp', version: 2 });
  });

  it('maps a renamed path to the new name without a version, and chains after a replace', () => {
    recordImageReplace('a.png', 'a.jpg', 3);
    recordImageRename('a.jpg', 'Neu/b.jpg');
    expect(resolveReplacedImage('/images/a.png')).toEqual({ path: '/images/Neu/b.jpg', version: null });
    expect(resolveReplacedImage('/images/a.jpg')).toEqual({ path: '/images/Neu/b.jpg', version: null });
  });

  it('re-renders thumbnails with an encoded, cache-busted src after a replace', () => {
    render(<Thumb path="/images/Eras Quiz/a.png" />);
    expect(screen.getByAltText('thumb')).toHaveAttribute('src', '/images/Eras%20Quiz/a.png');
    act(() => recordImageReplace('Eras Quiz/a.png', 'Eras Quiz/a.png', 9));
    expect(screen.getByAltText('thumb')).toHaveAttribute('src', '/images/Eras%20Quiz/a.png?v=9');
  });
});
