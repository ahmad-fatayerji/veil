import { Composition } from 'remotion';
import { Promo } from './Promo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="VeilPromo"
      component={Promo}
      durationInFrames={930}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
